import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  BUST_PX,
  CANVAS,
  CROP_X,
  CROP_Y,
  FADE_DARKEN,
  FADE_HEIGHT,
  FADE_TINT,
  LAYERS,
  PLATE_SRC,
  SHEET_DIR,
  SHIFT_X,
  TILE,
  buildPalette,
  recolor,
  tileRect,
} from "./catalog";

// The NUDGE_Y in catalog.js puts the crop window off the top of the BUST_PX
// bust, and sharp's extract() refuses a window that overhangs at all. So pad
// the bust out to hold it first. All four are 0 at a nudge of zero, which
// makes extend() a no-op — this stays correct however the nudges are dialled.
const PAD_TOP = Math.max(0, -CROP_Y);
const PAD_LEFT = Math.max(0, -CROP_X);
const PAD_BOTTOM = Math.max(0, CROP_Y + CANVAS - BUST_PX);
const PAD_RIGHT = Math.max(0, CROP_X + CANVAS - BUST_PX);

// A linear gradient from transparent to the plate's own darkened tint over
// the bottom FADE_HEIGHT of the canvas, cached like the sheets — it never
// changes. Drawn OVER the finished bust, not under it: the point is to
// swallow the chin cut, not to cast a shadow behind the head.
let fadeSvgCache = null;
function fadeSvg() {
  if (fadeSvgCache) return fadeSvgCache;
  const h = Math.round(CANVAS * FADE_HEIGHT);
  const { r, g, b } = FADE_TINT;
  const c = `rgb(${Math.round(r * FADE_DARKEN)},${Math.round(g * FADE_DARKEN)},${Math.round(b * FADE_DARKEN)})`;
  fadeSvgCache = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${c}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${c}" stop-opacity="1"/>` +
      `</linearGradient></defs>` +
      `<rect x="0" y="${CANVAS - h}" width="${CANVAS}" height="${h}" fill="url(#f)"/></svg>`,
  );
  return fadeSvgCache;
}

// Renders a saved portrait — the server half of the pair described in
// catalog.js. The browser draws the same layers through the same palette onto
// a canvas for the live preview; this runs once, on save, and produces the
// bytes that land in Character.avatarData.
//
// The client NEVER posts pixels. It posts the selection, and this re-renders
// it from the catalog, which is why a forged request can't smuggle an
// arbitrary image into an avatar — the worst it can do is pick a different
// nose. See docs/systemdocs/PORTRAITS.md.

const ASSET_ROOT = path.join(process.cwd(), "public");
const assetCache = new Map();

// Cache the encoded PNGs, not decoded pixels: 15 sheets are ~110KB on disk and
// ~25MB decoded, and a render is rare enough that decoding is free next to
// holding that resident.
function readAsset(publicPath) {
  if (!assetCache.has(publicPath)) {
    assetCache.set(
      publicPath,
      fs.readFile(path.join(ASSET_ROOT, publicPath)).catch((err) => {
        assetCache.delete(publicPath);
        throw err;
      }),
    );
  }
  return assetCache.get(publicPath);
}

function isBlank(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
}

/**
 * @param {object} selection a selection already through normalizeSelection
 * @returns {Promise<Buffer>} a CANVAS-square WebP
 */
export async function renderPortrait(selection) {
  const palette = buildPalette(selection);

  const composites = [];
  for (const layer of LAYERS) {
    // A null group is a layer with exactly one tile and no choice (the
    // cranium); everything else reads its index off the selection.
    const index = layer.group === null ? 0 : selection[layer.group];
    if (!Number.isInteger(index)) continue;

    const sheet = await readAsset(`${SHEET_DIR}/${layer.file}`);
    const { data, info } = await sharp(sheet)
      .extract(tileRect(index))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // "None" options are genuinely empty tiles rather than a missing file, so
    // there is nothing to special-case — but skipping them saves a composite.
    if (isBlank(data)) continue;

    recolor(data, palette);
    composites.push({
      input: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png()
        .toBuffer(),
      left: SHIFT_X,
      top: 0,
    });
  }

  // Composited onto a tile-width canvas first, then scaled once — scaling each
  // layer would soften every seam between them. The canvas is TILE + SHIFT_X
  // wide so the shift has somewhere to go (sharp refuses a composite that
  // overhangs), then cropped back; no part reaches x 123, so nothing is lost.
  const shifted = await sharp({
    create: { width: TILE + SHIFT_X, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Nearest, not the default Lanczos: this is pixel art, and every other
  // kernel turns its hard edges into mush at 2x. Scaled to BUST_PX rather
  // than straight to CANVAS, then cropped back down at CROP_X/CROP_Y — that
  // extra headroom is what pushes the chin cut below the plate's edge. The
  // padding is transparent, so wherever the window runs off the bust the
  // plate composited under it below simply shows through.
  //
  // Two passes, not one. sharp has a fixed pipeline order and runs extend()
  // AFTER the post-resize extract() regardless of the call order, so chaining
  // them produced a 256x269 bust and a composite that threw. Re-encoding to
  // PNG in between is lossless, so the pixels are the same either way.
  const padded = await sharp(shifted)
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    .resize(BUST_PX, BUST_PX, { kernel: "nearest" })
    .extend({
      top: PAD_TOP,
      bottom: PAD_BOTTOM,
      left: PAD_LEFT,
      right: PAD_RIGHT,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const bust = await sharp(padded)
    .extract({
      left: CROP_X + PAD_LEFT,
      top: CROP_Y + PAD_TOP,
      width: CANVAS,
      height: CANVAS,
    })
    .png()
    .toBuffer();

  return sharp(await readAsset(PLATE_SRC))
    .composite([{ input: bust }, { input: fadeSvg() }])
    .webp({ quality: 90 })
    .toBuffer();
}
