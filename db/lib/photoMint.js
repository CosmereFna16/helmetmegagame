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

const { PAPER_GROUP_SLUG } = require("./paper");
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

// Tag.name is @unique across the whole catalog, so retry on the violation
// rather than checking first — two photographers shooting in the same
// millisecond would both pass a pre-check and then one would throw. The
// suffix is bindBook's: `Photo (Young Man) (2)`.
async function createWithRetry(tx, buildData) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await tx.tag.create({ data: buildData(attempt) });
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  return null;
}

// The core. `subject` is the PRESENTED name (db/lib/photo.js#photoSubject) and
// `caption` the frozen readout (#photoCaption). Puts the print straight into
// `ownerId`'s hands and spends nothing — the camera is reusable, so there is
// nothing to charge.
async function mintPhoto(tx, ownerId, { subject, caption }) {
  const groupId = await photoGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PHOTO_SHAPE,
    groupId,
    slug: photoSlug(ownerId, attempt),
    name: attempt ? `${photoName(subject)} (${attempt + 1})` : photoName(subject),
    // Unlike paper, the description IS the content and it is stored plainly.
    // Safe because web/lib/referenceData.js only ships an `ephemeral` row to
    // whoever is holding it — a photo nobody holds reaches no browser.
    description: caption,
  }));
  if (!tag) throw new Error("Could not name the photo.");

  await addToStack(tx, ownerId, tag.id, 1, {});
  return tag;
}

// What comes out when the camera is pointed at nothing — the Consume path.
// Same row, no subject.
async function mintBlankPhoto(tx, ownerId) {
  const groupId = await photoGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PHOTO_SHAPE,
    groupId,
    slug: photoSlug(ownerId, attempt),
    name: attempt ? `${BLANK_PHOTO_NAME} (${attempt + 1})` : BLANK_PHOTO_NAME,
    description: BLANK_PHOTO_CAPTION,
    // Nobody is in it, so there is nothing to keep private.
    inspectVisibility: "ALWAYS",
  }));
  if (!tag) throw new Error("Could not name the photo.");

  await addToStack(tx, ownerId, tag.id, 1, {});
  return tag;
}

module.exports = { PHOTO_SHAPE, CAMERA_SLUG: "instant-camera", mintPhoto, mintBlankPhoto, photoSlug };
