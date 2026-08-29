// The portrait catalog: every part, every palette, and the rules for a valid
// selection. See docs/systemdocs/PORTRAITS.md.
//
// This module is the ONE source of truth shared by the two renderers — the
// browser canvas that draws the live preview (PortraitMaker.js) and the sharp
// pipeline that renders the saved avatar (web/lib/portrait/render.js). They
// draw the same layers, in the same order, through the same palette map, so a
// player never saves something that looks different from what they picked.
// The two agree pixel for pixel right up to the WebP encode, which shifts a
// channel by a unit here and there — the same lossy step the letter plaques
// already take, and invisible at any size an avatar is shown.
//
// Keep it free of `node:` builtins, sharp and Prisma: it is imported by a
// client component, and anything unbundlable here breaks the whole modal.

// The art ships as sprite sheets of 128x128 tiles, six to a row, indexed
// row-major — index 13 is row 2, column 1. That's the artist's own layout
// (web/assets/portrait-source-notes.txt); we kept it rather than splitting
// 220 files, because 15 requests beat 220 and the tile maths is two lines.
export const TILE = 128;
const SHEET_COLS = 6;

// Output size, matching AVATAR_SIZE in web/app/(app)/character/actions.js so an
// uploaded picture and a built portrait are the same shape on disk.
export const CANVAS = 256; // an integer multiple of TILE, so nearest-neighbour stays crisp

// The art is drawn left of the tile's centre — across every part in every
// sheet the ink spans x 16..104, centre 60 rather than 64. Undo that here so
// the bust sits centred in the plaque instead of visibly hugging its left
// edge. That correction is about the SHEETS; NUDGE_X/NUDGE_Y below are the
// separate, purely aesthetic framing choice.
export const SHIFT_X = 5;

// The bust is head + jaw only — no neck, no shoulders — so drawn at 1:1 the
// chin ends in a hard cut right on the plate's bottom edge, which reads as a
// severed head rather than a portrait. Two things fix it together:
// BUST_PX pushes that cut below the frame (scale up, then crop back down to
// CANVAS, bottom-anchored — the same "a bust sits in a frame" framing as
// SHIFT_X above, just vertical), and the FADE_* constants dissolve whatever
// chin is still left into the plate's own darkness instead of ending in a
// line. 320 keeps the intermediate scale (128 -> 320) an integer multiple of
// TILE, so nearest-neighbour stays crisp through the extra step.
export const BUST_PX = 320;

// Where that crop window sits. Plain centred-in-x and bottom-anchored (the
// window at 32, 64) left the head reading high and right in the plaque, so
// the two nudges move it: fractions of CANVAS, negative x for left, positive
// y for down. Change these, not the arithmetic below — both renderers read
// CROP_X/CROP_Y from here, which is what keeps them pixel-identical.
export const NUDGE_X = -0.08;
export const NUDGE_Y = 0.3;
export const CROP_X = Math.round((BUST_PX - CANVAS) / 2 - NUDGE_X * CANVAS);
// Negative once NUDGE_Y passes 0.25 — the window runs off the top of the
// bust, and the renderers pad for it rather than clamping. See render.js.
export const CROP_Y = Math.round(BUST_PX - CANVAS - NUDGE_Y * CANVAS);

export const FADE_HEIGHT = 0.3; // fraction of CANVAS the gradient covers, from the bottom
// Must match TINT / DARKEN in web/scripts/generate-letters.js — the fade is
// meant to read as "sinking into the plate's own shadow", not a new colour.
export const FADE_TINT = { r: 0x27, g: 0x44, b: 0x3e };
export const FADE_DARKEN = 0.5;

export const SHEET_DIR = "/assets/portrait";
// The same tinted-stone plate the letter plaques are built on
// (web/scripts/generate-letters.js), minus their inset rule — a thin white
// frame drawn over a full-bleed head reads as a scratch, not a frame.
export const PLATE_SRC = `${SHEET_DIR}/plate.webp`;

// ---------------------------------------------------------------------------
// Palettes
//
// The source art is painted in flat placeholder ramps that the original tool
// swapped through a shader; we do the same swap in a pixel loop. Every ramp
// below is keyed positionally, so entry N of a target ramp replaces entry N of
// its source ramp — never by name, never by luminance.
// ---------------------------------------------------------------------------

// Skin, 8 tones. Slot 1 is the cranium (the shadowed crown, seen only when
// bald or under thin hair) and slots 6-7 are small highlights.
const SKIN_SRC = ["#f3c99e", "#d3bea8", "#bc9485", "#ca9071", "#845e4b", "#f2b39c", "#e5ba8d", "#fde9d5"];

// Hair, 7 tones — used by the hair, beard and (via BROW_SRC below) brow sheets.
const HAIR_SRC = ["#6c4620", "#865c32", "#423024", "#32231d", "#a58264", "#4e4742", "#fae0c5"];

// Brows are painted as one flat tone rather than a ramp, so they get the
// darkest hair slot (index 3) and nothing else. Without this a blonde
// character keeps near-black brows.
const BROW_SRC = "#312723";
const BROW_HAIR_SLOT = 3;

// Pupils, 3 tones. The source is a literal +30-per-channel ramp, which is what
// gives it away as a placeholder rather than art.
const PUPIL_SRC = ["#1e3c5a", "#3c5a78", "#5a7896"];

// The seven skin ramps are lifted straight out of the artist's own
// Colour_Examples.png: four of them (porcelain, rose, fair, tan) appear there
// complete, and for the three deeper tones the sheet only shows five of the
// eight slots — the missing crown and highlight slots are least-squares fitted
// from the five it does show. On the four complete ramps that fit reproduces
// the real values to within a few units per channel, which is why it's trusted
// for the other three. Ordered light to dark; no names, because a swatch says
// it better than a word and nothing here needs a label.
export const SKIN_TONES = [
  { id: "porcelain", ramp: ["#f5d9c6", "#decec9", "#d3adb7", "#d8b2ab", "#9a616a", "#f3c8c2", "#edc6ad", "#fde9d5"] },
  { id: "rose", ramp: ["#f9c2ad", "#d9b7b2", "#d196a2", "#de9692", "#a76363", "#f7aea8", "#f8af93", "#ffdfda"] },
  { id: "fair", ramp: SKIN_SRC },
  { id: "tan", ramp: ["#e9ad82", "#caa38a", "#b07d6e", "#be7e5b", "#7d4d34", "#e99c80", "#df9e6e", "#fbd3aa"] },
  { id: "amber", ramp: ["#c7834e", "#b87c67", "#94594c", "#915431", "#613524", "#c77148", "#b57743", "#e69c84"] },
  { id: "bronze", ramp: ["#b57442", "#ad6c53", "#844c3f", "#7c492c", "#502c1f", "#aa623f", "#a46a39", "#db886a"] },
  { id: "umber", ramp: ["#864e37", "#7c4242", "#5b2c2c", "#592e1d", "#3a1823", "#744331", "#7b4730", "#9a5651"] },
];

// All thirteen hair ramps are the artist's, taken from the same sheet. The
// three unnatural ones carry `fantasy` — see the gating note further down.
export const HAIR_COLORS = [
  { id: "black", label: "Black", ramp: ["#252528", "#323037", "#221b1e", "#1b130f", "#52575f", "#2a2a2f", "#b3b4bf"] },
  { id: "dark-brown", label: "Dark brown", ramp: ["#49301b", "#634222", "#322217", "#261a14", "#865d3b", "#342b24", "#d19e6a"] },
  { id: "brown", label: "Brown", ramp: HAIR_SRC },
  { id: "chestnut", label: "Chestnut", ramp: ["#845628", "#a87643", "#67442a", "#4b2f25", "#bf9d65", "#645042", "#fce1c6"] },
  { id: "dark-blond", label: "Dark blond", ramp: ["#b18754", "#cba664", "#855f48", "#53382d", "#e3c48d", "#916d65", "#fef2b7"] },
  { id: "blond", label: "Blond", ramp: ["#ba9d7a", "#dcba7d", "#9b7965", "#6f4d40", "#e9cfa0", "#978377", "#fff7cf"] },
  { id: "ginger", label: "Ginger", ramp: ["#9e4c24", "#d67538", "#733719", "#4b2714", "#e8a965", "#75483f", "#fbcd9d"] },
  { id: "red", label: "Red", ramp: ["#882a1f", "#ae3c21", "#681818", "#450f0f", "#e27148", "#672e2e", "#feac8e"] },
  { id: "grey", label: "Grey", ramp: ["#726f6c", "#8f8d8a", "#545352", "#373635", "#aeaead", "#61656f", "#e0dedd"] },
  { id: "white", label: "White", ramp: ["#a9a6a4", "#c4c1bc", "#8a8784", "#635f5c", "#d8d2d2", "#919292", "#eeeceb"] },
  { id: "plum", label: "Plum", fantasy: true, ramp: ["#652439", "#7c3050", "#451d2f", "#2e111e", "#aa4864", "#4c2f3c", "#ec8faa"] },
  { id: "blue", label: "Blue", fantasy: true, ramp: ["#6686ad", "#84abd0", "#5a687e", "#444755", "#abd0e4", "#6d758c", "#d9effb"] },
  { id: "teal", label: "Teal", fantasy: true, ramp: ["#32565a", "#3a7b76", "#2c3a3f", "#1b1f22", "#63b5ae", "#374446", "#9ed9d4"] },
];

// Eye ramps are ours rather than the artist's: their sheet demonstrates the
// swap with magenta, cyan and red, which is exactly the register this setting
// isn't in. Same three-slot shape (shadow, iris, catchlight).
export const EYE_COLORS = [
  { id: "dark-brown", label: "Dark brown", ramp: ["#2e2119", "#46301f", "#6b4a2e"] },
  { id: "brown", label: "Brown", ramp: ["#4a3220", "#6b4a2b", "#94693c"] },
  { id: "amber", label: "Amber", ramp: ["#6b4413", "#a06a1c", "#c99340"] },
  { id: "hazel", label: "Hazel", ramp: ["#4b4a24", "#6f6b32", "#9a8f4a"] },
  { id: "green", label: "Green", ramp: ["#1f5236", "#2d7c4a", "#4aa268"] },
  { id: "blue", label: "Blue", ramp: ["#204b73", "#2a6ea6", "#4a97cc"] },
  { id: "pale-blue", label: "Pale blue", ramp: ["#4a6e85", "#6f96ad", "#9dbfd1"] },
  { id: "grey", label: "Grey", ramp: ["#43464a", "#626870", "#8b9199"] },
  { id: "violet", label: "Violet", fantasy: true, ramp: ["#653366", "#9b3f9e", "#c46ac6"] },
  { id: "crimson", label: "Crimson", fantasy: true, ramp: ["#6b1414", "#a81c1c", "#d64a4a"] },
];

// ---------------------------------------------------------------------------
// Layers
//
// Draw order, bottom to top — the artist's, verbatim, from
// web/assets/portrait-source-notes.txt. Reordering it is not a style choice:
// the jaw is painted over the back of the hair, and the front of the hair over
// the brows.
//
// `tints` names which palettes touch a sheet, and exists purely so the browser
// can re-tint four sheets when hair colour changes instead of all fifteen.
// ---------------------------------------------------------------------------
export const LAYERS = [
  { key: "cranium", file: "cranium.png", group: null, tints: ["skin"] },
  { key: "accessoryBack", file: "accessory-back.png", group: "accessory", tints: [] },
  { key: "earsBack", file: "ears-back.png", group: "ears", tints: ["skin"] },
  { key: "hairBack", file: "hair-back.png", group: "hair", tints: ["hair"] },
  { key: "jaw", file: "jaw.png", group: "face", tints: ["skin"] },
  { key: "earsFront", file: "ears-front.png", group: "ears", tints: ["skin"] },
  { key: "eyes", file: "eyes.png", group: "eyes", tints: ["skin"] },
  { key: "pupils", file: "pupils.png", group: "eyes", tints: ["eye"] },
  { key: "mouth", file: "mouth.png", group: "mouth", tints: ["skin"] },
  { key: "marks", file: "marks.png", group: "marks", tints: ["skin"] },
  { key: "beard", file: "beard.png", group: "beard", tints: ["hair"] },
  { key: "nose", file: "nose.png", group: "nose", tints: ["skin"] },
  { key: "brows", file: "brows.png", group: "brows", tints: ["skin", "hair"] },
  { key: "accessoryFront", file: "accessory-front.png", group: "accessory", tints: [] },
  { key: "hairFront", file: "hair-front.png", group: "hair", tints: ["hair"] },
];

// ---------------------------------------------------------------------------
// Groups — what the player actually picks.
//
// A group drives one or two layers at the same index: a hairstyle is a
// HairFront tile AND the HairBack tile at the same position, and neither half
// is a look on its own. That pairing is the artist's convention, and it's why
// the picker has ten rows rather than fifteen.
//
// `fantasy` lists indices that only appear while
// GameConfig.portraitFantasyPartsEnabled is on. Ravenheart is low fantasy and
// human-only, so pointed ears, horns and antlers are off by default rather
// than deleted — a GM running something stranger can flip one switch.
// ---------------------------------------------------------------------------
export const GROUPS = [
  { key: "face", label: "Face", count: 26, optional: false },
  { key: "eyes", label: "Eyes", count: 26, optional: false },
  { key: "brows", label: "Brows", count: 15, optional: true },
  { key: "nose", label: "Nose", count: 16, optional: false },
  { key: "mouth", label: "Mouth", count: 28, optional: false },
  // 0 is no visible ear (hidden under hair); 9-13 are the elf ears.
  { key: "ears", label: "Ears", count: 14, optional: true, fantasy: [9, 10, 11, 12, 13] },
  { key: "hair", label: "Hair", count: 28, optional: true },
  { key: "beard", label: "Facial hair", count: 14, optional: true },
  // Freckles, scars, moles, warpaint.
  { key: "marks", label: "Marks", count: 15, optional: true },
  // Glasses, monocles, eyepatches, piercings — plus 4 (antlers) and 5 (horns).
  { key: "accessory", label: "Extras", count: 12, optional: true, fantasy: [4, 5] },
];

const GROUP_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]));

// The colour pickers, kept beside GROUPS so the modal can render both from one
// list and normalizeSelection can validate both in one loop.
export const COLOR_GROUPS = [
  { key: "skin", label: "Skin", options: SKIN_TONES },
  { key: "hairColor", label: "Hair colour", options: HAIR_COLORS },
  { key: "eyeColor", label: "Eye colour", options: EYE_COLORS },
];

// A plain, unremarkable human — what an unset portrait opens on.
export const DEFAULT_SELECTION = Object.freeze({
  face: 0,
  eyes: 0,
  brows: 0,
  nose: 0,
  mouth: 0,
  ears: 1,
  hair: 1,
  beard: 0,
  marks: 0,
  accessory: 0,
  skin: 2,
  hairColor: 2,
  eyeColor: 1,
});

/** Whether an option in a part group is allowed right now. */
export function isPartAllowed(groupKey, index, allowFantasy) {
  const group = GROUP_BY_KEY.get(groupKey);
  if (!group) return false;
  if (!Number.isInteger(index) || index < 0 || index >= group.count) return false;
  return allowFantasy || !group.fantasy?.includes(index);
}

/** The indices of `group` a player may pick from, in display order. */
export function allowedParts(group, allowFantasy) {
  const all = Array.from({ length: group.count }, (_, i) => i);
  return allowFantasy ? all : all.filter((i) => !group.fantasy?.includes(i));
}

/** The options of a colour group a player may pick from. */
export function allowedColors(options, allowFantasy) {
  return allowFantasy ? options : options.filter((o) => !o.fantasy);
}

// Coerces anything at all into a selection that is safe to render. Every
// invalid, missing, out-of-range or fantasy-while-gated value falls back to
// DEFAULT_SELECTION's — the server action calls this on whatever the client
// posted, and the client calls it on whatever was stored, so neither can hand
// the renderer an index that isn't there.
export function normalizeSelection(raw, { allowFantasy = false } = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const out = {};

  for (const group of GROUPS) {
    const value = Number.parseInt(input[group.key], 10);
    out[group.key] = isPartAllowed(group.key, value, allowFantasy)
      ? value
      : DEFAULT_SELECTION[group.key];
  }

  for (const { key, options } of COLOR_GROUPS) {
    const value = Number.parseInt(input[key], 10);
    const option = Number.isInteger(value) ? options[value] : undefined;
    out[key] = option && (allowFantasy || !option.fantasy) ? value : DEFAULT_SELECTION[key];
  }

  return out;
}

/** Parses a stored Character.portrait string. Null/garbage yields the default. */
export function parseSelection(json, { allowFantasy = false } = {}) {
  if (!json) return { ...DEFAULT_SELECTION };
  try {
    return normalizeSelection(JSON.parse(json), { allowFantasy });
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}

/** A random, fully valid selection — the modal's Randomize button. */
export function randomSelection({ allowFantasy = false, random = Math.random } = {}) {
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const out = {};
  for (const group of GROUPS) out[group.key] = pick(allowedParts(group, allowFantasy));
  for (const { key, options } of COLOR_GROUPS) {
    const allowed = allowedColors(options, allowFantasy);
    out[key] = options.indexOf(pick(allowed));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The palette map
// ---------------------------------------------------------------------------

/** "#rrggbb" -> the 24-bit integer 0xrrggbb, the key both pixel loops use. */
function packHex(hex) {
  return Number.parseInt(hex.slice(1), 16);
}

/**
 * The full source-colour -> target-colour substitution for one selection, as
 * `Map<packedSrc, [r, g, b]>`.
 *
 * The three source ramps share no colour with each other, which is what lets
 * one flat map run over every sheet: a pixel is either in the map or it is
 * paint the player doesn't get to choose (lip red, eye white, the bone of a
 * horn), and passes through untouched.
 */
export function buildPalette(selection) {
  const map = new Map();
  const add = (srcRamp, dstRamp) => {
    srcRamp.forEach((src, i) => {
      const dst = dstRamp[i];
      if (!dst) return;
      const packed = packHex(dst);
      map.set(packHex(src), [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]);
    });
  };

  const skin = SKIN_TONES[selection.skin] ?? SKIN_TONES[DEFAULT_SELECTION.skin];
  const hair = HAIR_COLORS[selection.hairColor] ?? HAIR_COLORS[DEFAULT_SELECTION.hairColor];
  const eye = EYE_COLORS[selection.eyeColor] ?? EYE_COLORS[DEFAULT_SELECTION.eyeColor];

  add(SKIN_SRC, skin.ramp);
  add(HAIR_SRC, hair.ramp);
  add([BROW_SRC], [hair.ramp[BROW_HAIR_SLOT]]);
  add(PUPIL_SRC, eye.ramp);

  return map;
}

/** Rewrites an RGBA buffer in place through a palette from buildPalette. */
export function recolor(data, palette) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const hit = palette.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    if (!hit) continue;
    data[i] = hit[0];
    data[i + 1] = hit[1];
    data[i + 2] = hit[2];
  }
}

/** Where a tile index sits on its sheet. */
export function tileRect(index) {
  return {
    left: (index % SHEET_COLS) * TILE,
    top: Math.floor(index / SHEET_COLS) * TILE,
    width: TILE,
    height: TILE,
  };
}
