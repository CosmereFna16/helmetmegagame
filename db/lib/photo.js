// What a photograph shows, as one line of prose.
//
// Pure — no prisma, no I/O — the same posture as db/lib/examine.js, which is
// where its input comes from. A photo is an Examine that stopped moving: the
// camera reads the subject exactly as a bystander standing there would, and
// then that reading is frozen onto a Tag row forever, however the subject
// changes afterwards. That freeze is the whole feature. A photo of a man
// wearing a Knight's Helmet is evidence he wore one, and it stays evidence
// after he takes it off.
//
// See docs/systemdocs/PORTRAITS.md for the avatar side of a face, which this
// deliberately does not touch — a photo is words, and words can be handed to
// somebody who was not there.

// A photo is a THING, so it says what it shows in one breath rather than in
// the embed's labelled fields. Ailments and equipment run together for the
// same reason: a picture does not separate the wound from the armour, it just
// shows you both.
function joinBits(bits) {
  return bits.filter(Boolean).join(" · ");
}

// The caption, from an examineReadout() result. One ‡ at the very end, per
// CLAUDE.md — never one per sentence.
//
// The concealed branch is the readout's own: a hood in a photograph is still a
// hood, and nothing about pointing a camera at somebody gets past it. What
// survives is what a bystander could see anyway — the drawn dagger, the
// bandaged hand — which is exactly what examineReadout already decided.
function photoCaption(readout) {
  if (readout.concealed) {
    return `${readout.line} ${joinBits([...readout.ailments, ...readout.equipment])}`.trim() + " ‡";
  }

  const appearance = readout.appearance || "Nothing you can make out.";
  const tags = joinBits(readout.tags.map((t) => t.name));
  return [appearance, tags].filter(Boolean).join(" ") + " ‡";
}

// What the camera prints when nobody is in front of it. Bascinet's line, so no
// ‡ (CLAUDE.md's verbatim exemption).
const BLANK_PHOTO_CAPTION = "A nice photo.";
const BLANK_PHOTO_NAME = "Photo";

// `Photo (Young Man)`. The subject goes in the NAME rather than only the
// description, because a photo is something you sort through a stack of — a
// pile of rows all called "Photo" would be unusable, and the name is the only
// thing an inventory list, a stash and a Transfer dialog all show.
function photoName(subject) {
  return `Photo (${subject})`;
}

module.exports = { photoCaption, photoName, BLANK_PHOTO_CAPTION, BLANK_PHOTO_NAME };
