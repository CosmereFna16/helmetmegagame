// Continuous HSL gradient for personal character roles, swept across three
// muted families — cool cyan-grey, terracotta/brown, and forest green — so
// the guild member list reads as a forest, not a rainbow. Colors are picked
// from a smooth interpolation across the full 32-bit hash space rather than
// a small discrete bucket list: the old version hashed each name into one of
// ~48 fixed swatches (`hash % 48`), so two names could easily land on the
// same bucket by coincidence, which is why some renames didn't visibly
// change anything. Interpolating continuously makes every distinct name
// resolve to a distinct color in practice.
const GRADIENT_STOPS = [
  { h: 195, s: 13, l: 36 }, // cool cyan-grey
  { h: 25, s: 20, l: 34 }, // muted terracotta
  { h: 32, s: 15, l: 30 }, // brown
  { h: 140, s: 14, l: 30 }, // forest green
  { h: 165, s: 12, l: 33 }, // teal-green, eases back toward cyan-grey
];

// djb2 — deterministic, cheap, wide dispersion across the full 32-bit range.
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest-path hue interpolation so a wrap (e.g. 350 -> 10) doesn't sweep
// the long way around the color wheel.
function lerpHue(a, b, t) {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

function hslToRgbInt(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toByte = (v) => Math.round((v + m) * 255);
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

// Same name always yields the same color; virtually any name change lands
// on a different point along the gradient. Used both to create a
// character's personal Discord role and to re-color it on every rename (see
// web/lib/discordGuild.js#ensureCharacterRole).
function hashNameToColor(name) {
  const hash = hashString(name);
  const t = hash / 0xffffffff; // continuous position in [0, 1)

  const segments = GRADIENT_STOPS.length;
  const scaled = t * segments;
  const index = Math.floor(scaled) % segments;
  const next = (index + 1) % segments;
  const localT = scaled - Math.floor(scaled);

  const stopA = GRADIENT_STOPS[index];
  const stopB = GRADIENT_STOPS[next];
  const h = lerpHue(stopA.h, stopB.h, localT);
  const s = lerp(stopA.s, stopB.s, localT);
  const l = lerp(stopA.l, stopB.l, localT);

  // Small independent jitter (from a second hash of the same name) so names
  // that land close together on the gradient still separate a bit further.
  const jitterHash = hashString(`${name}|jitter`);
  const lJitter = ((jitterHash % 700) - 350) / 100; // +/-3.5 lightness
  const sJitter = (((jitterHash >>> 8) % 400) - 200) / 100; // +/-2 saturation

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  return hslToRgbInt(h, clamp(s + sJitter, 6, 30), clamp(l + lJitter, 22, 50));
}

module.exports = { GRADIENT_STOPS, hashNameToColor };
