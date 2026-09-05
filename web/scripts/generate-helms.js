// Generates the concealed-identity avatars: one plated 256px WebP per piece of
// concealing headgear, from the 32x32 source sprites in web/assets/helms.
//
// A character wearing something with Tag.concealsIdentity is served one of
// these instead of their own face, chosen by Tag.concealSprite through
// db/lib/presentedIdentity.js. There is no per-character render — every wearer
// of a given helm looks identical, which is the point of concealment, and it
// means these can be flat files served straight out of public/.
//
// One-off, with committed output — not a build step. Re-run it after adding a
// source sprite or changing the tuning constants below:
//
//   npm run assets:helms --workspace=web
//
// The plate is the same tinted stone a built portrait sits on, and the bottom
// fade is the same gradient, for the same reason generate-letters.js shares the
// plate: a helm and a face turn up side by side in one Discord channel, and two
// treatments free to drift would stop matching.

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "assets/helms");
const OUT_DIR = path.join(ROOT, "public/assets/helms");
const PLATE = path.join(ROOT, "public/assets/portrait/plate.webp");

// --- Tuning -----------------------------------------------------------------
const SIZE = 256; // CANVAS in web/lib/portrait/catalog.js
// Target for the GEOMETRIC MEAN of the sprite's tight bounding box, not for
// its width or its height. That distinction is the whole trick here, and it is
// worth spelling out, because the two obvious rules both look wrong:
//
//   fit  (scale by the LARGER side)  — a wide brim hits the sides while the
//        crown is still tiny, so a jester's cap renders half the size of a
//        skull mask and the sheet looks ragged.
//   fill (scale by the SMALLER side) — the same brim then overshoots to 335px
//        on a 256px canvas, and most of the hat is cropped away.
//
// sqrt(w*h) splits the difference and holds apparent visual MASS constant
// instead of any one edge, which is what the eye actually compares.
//
// Raised from 190. At 190 the mean landed well inside the frame and a helm read
// as a small object floating on a large plate, next to a portrait that fills
// its frame edge to edge. At 215 one sprite of the 21 — knight0, the tallest —
// hits the ceiling and is clamped down to fit; the other twenty land between
// 195 and 237 on their long edge. The clamp below is what makes the higher
// number safe, and it is what to reach for before lowering this again.
const TARGET = 215;
// Fraction of the canvas height the sprite's centre sits at. Dead centre reads
// as floating; a portrait bust puts the face high and fills the bottom with
// shoulders, so nudging up matches the framing of the thing this sits beside.
const CENTRE_Y = 0.47;

// The bottom fade a built portrait gets (web/lib/portrait/render.js#fadeSvg,
// constants in web/lib/portrait/catalog.js). There it dissolves the bust's hard
// chin cut into the plate; here there is no cut to hide, but the effect is the
// other half of why a face sits IN its frame and a helm sat ON one. Drawn over
// the sprite, not under it, exactly as the portrait does.
//
// Duplicated rather than imported: catalog.js is ESM and this script is CJS,
// and generate-letters.js already keeps its own copy of the same pair for the
// same reason. Must match TINT/DARKEN in web/scripts/generate-letters.js and
// FADE_TINT/FADE_DARKEN/FADE_HEIGHT in web/lib/portrait/catalog.js.
const FADE_HEIGHT = 0.3;
const FADE_TINT = { r: 0x27, g: 0x44, b: 0x3e };
const FADE_DARKEN = 0.5;

// Built once — it never varies — and reused across all 21 sprites.
function fadeSvg() {
  const h = Math.round(SIZE * FADE_HEIGHT);
  const { r, g, b } = FADE_TINT;
  const c = `rgb(${Math.round(r * FADE_DARKEN)},${Math.round(g * FADE_DARKEN)},${Math.round(b * FADE_DARKEN)})`;
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${c}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${c}" stop-opacity="1"/>` +
      `</linearGradient></defs>` +
      `<rect x="0" y="${SIZE - h}" width="${SIZE}" height="${h}" fill="url(#f)"/></svg>`,
  );
}
const FADE = fadeSvg();

// The tight bounding box of everything non-transparent, so the normalisation
// measures the ART and not the 32x32 cell it was cut from. Every sprite here
// is padded differently inside that cell, which is exactly why measuring the
// cell would reproduce the raggedness TARGET exists to remove.
function boundingBox(data, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 10) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function build(file) {
  const name = path.basename(file, ".png");
  const src = path.join(SRC_DIR, file);

  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = boundingBox(data, info.width, info.height);
  if (!box) throw new Error(`${file} is entirely transparent`);

  // The geometric-mean rule, then a clamp. TARGET holds apparent visual MASS
  // constant, which is the right rule for everything that fits — but it says
  // nothing about either edge, so a wide brim or a tall plume can overshoot the
  // canvas at a target the rest of the sheet is comfortable at. Scaling that one
  // sprite down to fit costs it a little mass and keeps every other sprite at
  // the size the rule chose, which beats lowering TARGET for all 21 to
  // accommodate the widest.
  let scale = TARGET / Math.sqrt(box.width * box.height);
  scale = Math.min(scale, SIZE / box.width, SIZE / box.height);
  const w = Math.round(box.width * scale);
  const h = Math.round(box.height * scale);

  // Nearest, not the default Lanczos: this is pixel art, and every other
  // kernel turns its hard edges into mush. Two sharp calls rather than one
  // chain — sharp has a fixed pipeline order and runs extract() and resize()
  // in its own sequence regardless of how they are chained, which is the same
  // trap web/lib/portrait/render.js documents. Re-encoding to PNG in between
  // is lossless, so the pixels are identical either way.
  const cropped = await sharp(src).extract(box).png().toBuffer();
  const scaled = await sharp(cropped).resize(w, h, { kernel: "nearest" }).png().toBuffer();

  const left = Math.round((SIZE - w) / 2);
  // CENTRE_Y wants the sprite high on the plate, but a sprite that now fills
  // the full height has nowhere to go: at h === SIZE the ideal top is -8, and a
  // negative offset silently shaves the crown off a helmet. Clamped into the
  // canvas, so the framing rule applies wherever there is room for it and
  // quietly gives way where there is not.
  const top = Math.max(0, Math.min(SIZE - h, Math.round(SIZE * CENTRE_Y - h / 2)));

  await sharp(PLATE)
    .composite([{ input: scaled, left, top }, { input: FADE, left: 0, top: 0 }])
    .webp({ quality: 90 })
    .toFile(path.join(OUT_DIR, `${name}.webp`));

  return { name, box: `${box.width}x${box.height}`, out: `${w}x${h}` };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SRC_DIR)).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) throw new Error(`no source sprites in ${SRC_DIR}`);

  for (const file of files) {
    const r = await build(file);
    console.log(`  ${r.name.padEnd(18)} ${r.box.padEnd(8)} -> ${r.out}`);
  }
  console.log(`\n${files.length} helm avatars -> ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
