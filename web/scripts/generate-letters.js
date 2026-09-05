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
//
// **Check the output before committing it.** On a machine with no fontconfig
// setup, pango prints `Fontconfig error: Cannot load default config file`,
// ignores `fontfile`, silently substitutes a default sans face, and the script
// still exits 0 — leaving 27 plaques that say A in Helvetica. It is a warning,
// not an error, so nothing here can catch it; open one plaque and look.

// That trap is live on at least one dev Mac, and FONTCONFIG_FILE does not get
// around it — this sharp build's bundled fontconfig ignores the config and the
// `fontfile` both. So when the shade ramp below was added, the plaques already
// in public/assets/letters could not be re-rendered here; the ramp was applied
// over them instead of under the glyph, which dims the ink's lower half
// slightly. It reads fine. The next successful run of this script on a machine
// with fonts supersedes them with the plate-baked version, and nothing needs
// undoing first.

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const BACKGROUND = path.join(ROOT, "public/assets/background.png");
const FONT_FILE = path.join(ROOT, "assets/fonts/UnifrakturMaguntia.ttf");
const OUT_DIR = path.join(ROOT, "public/assets/letters");
// The same tinted stone, frameless, as the backing plate for a built portrait
// (docs/systemdocs/PORTRAITS.md). It lives here rather than in its own script
// because it is literally the plaque without its glyph and rule — a second
// script would mean a second copy of TINT/DARKEN/BLUR, free to drift, and then
// a portrait and a letter plaque would stop matching in a gallery.
const PORTRAIT_PLATE = path.join(ROOT, "public/assets/portrait/plate.webp");

// --- Tuning -----------------------------------------------------------------
const SIZE = 256; // matches AVATAR_SIZE in character/actions.js
// Dusk's --surface-raised and --surface (web/app/globals.css). The plaque is
// meant to sit in the same lamplit green as the panels behind it.
const TINT = { r: 0x27, g: 0x44, b: 0x3e };
const DARKEN = 0.5; // brightness multiplier; the plate has to stay well under the ink
const BLUR = 2.5; // abstracts the source photo into mottled stone rather than a legible forest
// The plate used to be evenly lit, which made anything standing on it look
// pasted onto a slab rather than sitting on one. A vertical darkening ramp
// gives it a floor: the subject is in the light at the top and its base sinks
// into shade. Black rather than the teal, so this deepens the stone instead of
// shifting its hue — and it rides on the shared plate, so a built portrait, a
// helm avatar and a letter plaque all get it without one of them opting in.
const SHADE_TOP = 0.0; // opacity where the ramp begins
const SHADE_BOTTOM = 0.5; // opacity at the bottom edge
const SHADE_START = 0.15; // fraction down the plate the ramp begins
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

  // A third pass, not a link in either chain above: the tint has to be last
  // and alone (see the comment on this function), so the shade goes on after
  // it, over a plate that is already teal.
  const tinted = await sharp(stone).tint(TINT).png().toBuffer();
  return sharp(tinted).composite([{ input: shadeSvg() }]).png().toBuffer();
}

// The darkening ramp, over the full canvas. Starts at SHADE_START rather than
// the top edge so the lit half stays lit and only the lower plate falls away.
function shadeSvg() {
  return Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#000" stop-opacity="${SHADE_TOP}" />
         <stop offset="${SHADE_START}" stop-color="#000" stop-opacity="${SHADE_TOP}" />
         <stop offset="1" stop-color="#000" stop-opacity="${SHADE_BOTTOM}" />
       </linearGradient></defs>
       <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#s)" />
     </svg>`,
  );
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

  await fs.mkdir(path.dirname(PORTRAIT_PLATE), { recursive: true });
  await sharp(plate).webp({ quality: WEBP_QUALITY }).toFile(PORTRAIT_PLATE);

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

  console.log(
    `done (${LETTERS.length} letters + _default -> ${path.relative(ROOT, OUT_DIR)}, ` +
      `plate -> ${path.relative(ROOT, PORTRAIT_PLATE)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
