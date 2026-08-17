// Curated, very-muted palette for personal character roles — cyan / terracotta
// / brown / green only, no saturated outliers, so the guild member list reads
// as a forest rather than a rainbow. #635249 (index 0) is the reference tone
// the palette was built around.
const ROLE_COLOR_PALETTE = [
  "#635249", "#6b5a4d", "#5c4d42", "#71604f", "#544639", "#7a6653", "#4f4238",
  "#836e58", "#493e35", "#8c7860", "#6e5744", "#5a4636", "#786151", "#4a3c30",
  "#8a6f57", "#5f4f45", "#68584b", "#75604a", "#503f34", "#8b7663", "#664f3e",
  "#4d443c", "#7c6a5e", "#584a41", "#4c5a52", "#3f4e47", "#566058", "#475650",
  "#5f6b62", "#3a4a43", "#657268", "#495951", "#54615a", "#425049", "#6c786e",
  "#3d4b45", "#5a685f", "#465852", "#61706a", "#4b5951", "#455a5c", "#385052",
  "#4e6668", "#3a4f50", "#54696b", "#405658", "#496062", "#3c5254",
];

// djb2 — deterministic, cheap, good-enough dispersion for a ~48-slot palette.
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

function hexToInt(hex) {
  return parseInt(hex.slice(1), 16);
}

// Same name always yields the same color; any name change is very likely to
// land on a different palette slot. Used both to create a character's
// personal Discord role and to re-color it on every rename (see
// web/lib/discordGuild.js#ensureCharacterRole).
function hashNameToColor(name) {
  const index = hashString(name) % ROLE_COLOR_PALETTE.length;
  return hexToInt(ROLE_COLOR_PALETTE[index]);
}

module.exports = { ROLE_COLOR_PALETTE, hashNameToColor };
