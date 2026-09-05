// Taking a picture: the row that comes out of a camera.
//
// This is the FIFTH runtime authoring door onto the tag catalog, beside
// docs/tags.yaml, the GM form at /gm/dev/tags, the corpse/headstone/crate
// minters and db/lib/paperMint.js — which this file is modelled on almost
// line for line. Every row carries `custom: true` so db:sync-tags never sees
// it and db:prune-tags skips it, plus `ephemeral: true` so a Restart Game
// sweeps it up.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays off the @lifeweb/db barrel.
//
// A photo lives in the PAPER group, which is a chip colour and nothing else —
// the paper SYSTEM matches on `paperKind`, and a photo carries none, so it can
// never be written on, sealed, pinned to a noticeboard or put behind the
// literacy gate. A printed photograph is a piece of card in your pocket, and
// that is the shelf it belongs on.

const { PAPER_GROUP_SLUG, noteCode } = require("./paper");
const { createWithRetry } = require("./paperMint");
const { photoName, BLANK_PHOTO_CAPTION, BLANK_PHOTO_NAME } = require("./photo");
const { addToStack } = require("./tagWrites");

// Same shape paperMint.js's customSlug uses, and for the same reason: two
// photos of one man on one day are genuinely different objects, so the
// uniquifier is the owner and the clock rather than anything about the subject.
function photoSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-photo-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

const PHOTO_SHAPE = {
  category: "items",
  pointCost: 0,
  custom: true,
  ephemeral: true,
  tradeable: true,
  // Weightless, the same call paperMint.js makes: a photograph against a carry
  // cap measured in pounds is noise.
  weightLbs: 0,
  // One photo is one photo. Two shots of the same man are not the same object.
  stackable: false,
  // Not binnable from the Destroy menu, for paper's reason: burning evidence
  // is a thing the fiction should have to say out loud.
  removable: false,
  purchasable: false,
  purchasableAfterStart: false,
  // A photo in your pocket is not something the room can read over your
  // shoulder. WHO is in it is the whole secret, and the name carries that —
  // so the name is exactly what an Examine must not show.
  inspectVisibility: "HIDDEN",
};

async function photoGroupId(tx) {
  const group = await tx.tagGroup.findUnique({ where: { slug: PAPER_GROUP_SLUG }, select: { id: true } });
  return group?.id ?? null;
}

// createWithRetry comes from db/lib/paperMint.js rather than being retyped —
// it is the same loop over the same @unique on Tag.name.
//
// ** Everything below hands it the TOP-LEVEL client, never a transaction. **
// Postgres aborts a whole transaction the moment one statement in it fails, so
// a catch-and-retry inside `$transaction` can only raise 25P02 on the second
// attempt. That matters far more for a photo than for anything else that
// retries this way: `Photo (Young Man)` is a name the game produces over and
// over, so the collision is the NORMAL case rather than a millionth-write
// freak. Hence createPhotoRow, which the transactional caller runs first and
// attaches afterwards.

// The second and later photos of the same face. A print code rather than a
// "(2)" suffix, paperMint.js's reasoning exactly: "Photo (Young Man)" and
// "Photo (Young Man) (2)" would look related and are not — they are two
// different young men as often as they are two shots of one.
function disambiguated(subject, attempt) {
  return attempt === 0 ? photoName(subject) : photoName(`${subject} · ${noteCode()}`);
}

// The row, and nothing else. `db` must be the top-level client (see
// createWithRetry). Creating it puts it in nobody's hands — `attachPhoto`
// does that — so the two halves can straddle a transaction boundary.
//
// An orphaned row, if the caller's transaction then rolls back, costs nothing:
// it is `ephemeral`, so a Restart Game sweeps it, and
// web/lib/referenceData.js only ships an ephemeral row to whoever HOLDS it, so
// a photo in nobody's hands reaches no browser at all.
async function createPhotoRow(db, ownerId, { name, caption, inspectVisibility }) {
  const groupId = await photoGroupId(db);

  const tag = await createWithRetry(db, (attempt) => ({
    ...PHOTO_SHAPE,
    groupId,
    slug: photoSlug(ownerId, attempt),
    name: name(attempt),
    // Unlike paper, the description IS the content and it is stored plainly —
    // safe for the referenceData reason above. There is no literacy gate on a
    // picture, which is the whole point of one.
    description: caption,
    ...(inspectVisibility ? { inspectVisibility } : {}),
  }));
  if (!tag) throw new Error("Could not name the photo.");
  return tag;
}

// Puts a created row into somebody's hands. Safe inside a transaction — it is
// the half that has to be atomic with whatever the caller is also writing.
async function attachPhoto(tx, ownerId, tag) {
  await addToStack(tx, ownerId, tag.id, 1, {});
  return tag;
}

// The whole thing, for a caller with nothing else to make atomic: the 📸
// reaction, which spends nothing — the camera is reusable, so there is no
// charge to keep in step with the print.
//
// `subject` is the PRESENTED name (db/lib/photo.js#photoSubject) and `caption`
// the frozen readout (#photoCaption).
async function mintPhoto(db, ownerId, { subject, caption }) {
  const tag = await createPhotoRow(db, ownerId, {
    name: (attempt) => disambiguated(subject, attempt),
    caption,
  });
  return attachPhoto(db, ownerId, tag);
}

// What comes out when the camera is pointed at nothing — the Consume path,
// which DOES have something to keep atomic (the camera coming off the stack),
// so it uses createPhotoRow + attachPhoto rather than this.
async function createBlankPhotoRow(db, ownerId) {
  return createPhotoRow(db, ownerId, {
    name: (attempt) => (attempt === 0 ? BLANK_PHOTO_NAME : `${BLANK_PHOTO_NAME} (${noteCode()})`),
    caption: BLANK_PHOTO_CAPTION,
    // Nobody is in it, so there is nothing to keep private.
    inspectVisibility: "ALWAYS",
  });
}

module.exports = {
  CAMERA_SLUG: "instant-camera",
  createPhotoRow,
  createBlankPhotoRow,
  attachPhoto,
  mintPhoto,
};
