// Generates the default character avatars: a teal-tinted stone plaque bearing
// a blackletter capital, one per letter A-Z plus a blank fallback.
//
// A character with no uploaded picture is served one of these by
// web/app/api/avatar/[characterId]/route.js, chosen from the first letter of
// their FIRST name (never the honorific or the granted title). That lookup
// happens at read time, which is why nothing here has to run on a rename.
//
// One-off, with committed output — not a build step. Re-run it after changing
// the tuning constants below or replacing background.png:
//
//   npm run assets:letters --workspace=web
//
// The font is vendored as a TTF because this renders through sharp's pango
// text support, and pango cannot read the .woff2 that next/font/google caches
// into .next. It is UnifrakturMaguntia, the same face --font-display uses for
// the login wordmark, so the plaques and the wordmark match.

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const BACKGROUND = path.join(ROOT, "public/assets/background.png");
const FONT_FILE = path.join(ROOT, "assets/fonts/UnifrakturMaguntia.ttf");
const OUT_DIR = path.join(ROOT, "public/assets/letters");

// --- Tuning -----------------------------------------------------------------
const SIZE = 256; // matches AVATAR_SIZE in character/actions.js
// Dusk's --surface-raised and --surface (web/app/globals.css). The plaque is
// meant to sit in the same lamplit green as the panels behind it.
const TINT = { r: 0x27, g: 0x44, b: 0x3e };
const DARKEN = 0.5; // brightness multiplier; the plate has to stay well under the ink
const BLUR = 2.5; // abstracts the source photo into mottled stone rather than a legible forest
// Dusk's --text. Warmer against the teal than pure white; set to "#ffffff" for
// a colder, harder plaque.
const INK = "#efe7d6";
const GLYPH_BOX = 132; // the square the trimmed glyph is fitted into
const FRAME_INSET = 18; // white rule, echoing the frame on an illuminated initial
const FRAME_WIDTH = 2;
const FRAME_OPACITY = 0.85;
// WebP, matching what updateCharacterProfile already stores for an uploaded
// avatar — so the route serves one content type either way, and 27 plates
// cost ~145KB in the repo instead of ~1MB as PNG.
const WEBP_QUALITY = 88;
// ----------------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// The tinted stone tile, shared by every letter — rendered once.
//
// Two passes, with the tint LAST and alone, deliberately: chaining .tint()
// and .modulate() in a single pipeline silently drops the tint and returns a
// flat greyscale plate (sharp applies modulate after tint and it clears the
// chroma). Splitting them is the whole reason this reads teal.
async function buildPlate() {
  const stone = await sharp(BACKGROUND)
    .resize(SIZE, SIZE, { fit: "cover" })
    .greyscale()
    // The source is a photograph of a hillside; blurred, it stops reading as
    // trees and starts reading as the mottling in a slab of green marble.
    .blur(BLUR)
    .modulate({ brightness: DARKEN })
    .png()
    .toBuffer();

  return sharp(stone).tint(TINT).png().toBuffer();
}

function frameSvg() {
  const inset = FRAME_INSET;
  const side = SIZE - inset * 2;
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${inset}" y="${inset}" width="${side}" height="${side}"
             fill="none" stroke="${INK}" stroke-width="${FRAME_WIDTH}"
             stroke-opacity="${FRAME_OPACITY}" />
     </svg>`,
  );
}

// Blackletter capitals differ wildly in width and in how far they overshoot
// the baseline, so rendering every glyph at one point size makes some tower
// over others. Render big, trim to the actual ink, then fit that into a fixed
// box — every letter then reads as the same visual weight.
async function renderGlyph(letter) {
  const raw = await sharp({
    text: {
      text: `<span foreground="${INK}">${letter}</span>`,
      font: "UnifrakturMaguntia 200",
      fontfile: FONT_FILE,
      rgba: true,
    },
  })
    .png()
    .toBuffer();

  return sharp(raw)
    .trim()
    .resize(GLYPH_BOX, GLYPH_BOX, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  for (const file of [BACKGROUND, FONT_FILE]) {
    try {
      await fs.access(file);
    } catch {
      console.error(`Missing required asset: ${path.relative(ROOT, file)}`);
      process.exit(1);
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const plate = await buildPlate();
  const frame = frameSvg();

  // The fallback: plaque and frame, no glyph. Served for an initial that is
  // not a plain A-Z — an accented or non-Latin first letter, a digit, or a
  // character whose firstName is somehow empty.
  await sharp(plate)
    .composite([{ input: frame }])
    .webp({ quality: WEBP_QUALITY })
    .toFile(path.join(OUT_DIR, "_default.webp"));

  for (const letter of LETTERS) {
    const glyph = await renderGlyph(letter);
    await sharp(plate)
      .composite([{ input: frame }, { input: glyph, gravity: "centre" }])
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(OUT_DIR, `${letter}.webp`));
  }

  console.log(`done (${LETTERS.length} letters + _default -> ${path.relative(ROOT, OUT_DIR)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
