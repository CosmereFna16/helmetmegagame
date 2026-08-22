import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  CANVAS,
  LAYERS,
  PLATE_SRC,
  SHEET_DIR,
  SHIFT_X,
  TILE,
  buildPalette,
  recolor,
  tileRect,
} from "./catalog";

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

  const bust = await sharp(shifted)
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    // Nearest, not the default Lanczos: this is pixel art, and every other
    // kernel turns its hard edges into mush at 2x.
    .resize(CANVAS, CANVAS, { kernel: "nearest" })
    .png()
    .toBuffer();

  return sharp(await readAsset(PLATE_SRC))
    .composite([{ input: bust }])
    .webp({ quality: 90 })
    .toBuffer();
}
