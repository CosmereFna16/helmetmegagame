// The portrait catalog: parts, palettes, and valid-selection rules. See
// docs/systemdocs/PORTRAITS.md.
//
// Shared by both renderers (PortraitMaker.js preview, render.js save) so a
// saved portrait matches the picker. Keep free of node:/sharp/Prisma — a
// client component imports this.

// Sprite sheets: 128x128 tiles, six per row, row-major (index 13 = row 2,
// col 1) — the artist's layout (web/assets/portrait-source-notes.txt).
export const TILE = 128;
const SHEET_COLS = 6;

// Output size, matching AVATAR_SIZE in web/app/(app)/character/actions.js.
export const CANVAS = 256; // an integer multiple of TILE, so nearest-neighbour stays crisp

// The art sits left of tile centre (ink spans x 16..104, centre 60 not 64).
// SHIFT_X corrects that so the bust reads centred in the plaque.
export const SHIFT_X = 5;

// The bust is head+jaw only, so at 1:1 the chin hard-cuts at the plate's
// bottom edge. BUST_PX scales up then crops back to CANVAS, bottom-anchored,
// to push that cut below frame; FADE_* fades the rest into shadow.
export const BUST_PX = 320;

// CROP_X/CROP_Y (fractions of CANVAS) are measured, not taste — 0.08 clips
// the least of the hair/headwear crown loss. Both renderers import these;
// don't move without re-measuring.
export const NUDGE_Y = 0.08;
// Heads are three-quarter, not frontal, so strict x-centring reads off-
// centre; NUDGE_X -0.03 corrects it while keeping margin on the widest tile.
export const NUDGE_X = -0.03;

export const CROP_X = Math.round((BUST_PX - CANVAS) / 2 - NUDGE_X * CANVAS);
export const CROP_Y = Math.round(BUST_PX - CANVAS - NUDGE_Y * CANVAS);

export const FADE_HEIGHT = 0.3; // fraction of CANVAS the gradient covers, from the bottom
// Must match TINT / DARKEN in web/scripts/generate-letters.js.
export const FADE_TINT = { r: 0x27, g: 0x44, b: 0x3e };
export const FADE_DARKEN = 0.5;

export const SHEET_DIR = "/assets/portrait";
// The tinted-stone plate the letter plaques use (web/scripts/generate-letters.js),
// minus their inset rule.
export const PLATE_SRC = `${SHEET_DIR}/plate.webp`;

// Palettes — flat placeholder ramps swapped in a pixel loop; each ramp is
// keyed positionally (entry N replaces entry N), never by name or luminance.

// Skin, 8 tones. Slot 1 is the cranium (the shadowed crown, seen only when
// bald or under thin hair) and slots 6-7 are small highlights.
const SKIN_SRC = ["#f3c99e", "#d3bea8", "#bc9485", "#ca9071", "#845e4b", "#f2b39c", "#e5ba8d", "#fde9d5"];

// Hair, 7 tones — used by the hair, beard and (via BROW_SRC below) brow sheets.
const HAIR_SRC = ["#6c4620", "#865c32", "#423024", "#32231d", "#a58264", "#4e4742", "#fae0c5"];

// Brows are painted as one flat tone, so they get the darkest hair slot
// (index 3) and nothing else.
const BROW_SRC = "#312723";
const BROW_HAIR_SLOT = 3;

const PUPIL_SRC = ["#1e3c5a", "#3c5a78", "#5a7896"];

// Skin ramps are from the artist's Colour_Examples.png; deeper tones'
// missing slots are least-squares fitted from the shown five. Light to dark.
const SKIN_TONES = [
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
const HAIR_COLORS = [
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

// Eye ramps are ours, not the artist's placeholder sheet. Same three-slot
// shape (shadow, iris, catchlight).
const EYE_COLORS = [
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

// Layers — draw order bottom to top, the artist's own; not reorderable
// (jaw over hair-back, hair-front over brows). `tints` says which palettes
// touch a sheet, so the browser can re-tint four instead of all fifteen.
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

// Groups — what the player picks. A group can drive two layers at once
// (hairstyle = HairFront + HairBack at the same index). `fantasy` indices
// only appear when GameConfig.portraitFantasyPartsEnabled is on.
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
const DEFAULT_SELECTION = Object.freeze({
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
function isPartAllowed(groupKey, index, allowFantasy) {
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

// Coerces anything into a safe-to-render selection — invalid, missing, or
// fantasy-while-gated values fall back to DEFAULT_SELECTION.
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

/** "#rrggbb" -> the 24-bit integer 0xrrggbb, the key both pixel loops use. */
function packHex(hex) {
  return Number.parseInt(hex.slice(1), 16);
}

/** Source->target colour substitution for one selection (packed RGB -> [r,g,b]);
 * unmapped pixels (lip red, eye white, horn bone) pass through untouched. */
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
