// What "Persistent" looks like, in the one place both the Dawn wipe and the
// /persistent command can agree on it.
//
// Two markers, because the two channel types can't share one. A forum post
// carries the real "Persistent" (⏰) forum tag. A private thread lives under a
// TEXT channel, which cannot have forum tags at all, so it's marked by a ⏰
// prefix on the thread's own name instead — cheap to test, because
// db/lib/dawnWipe.js already fetches the raw thread objects with `name`
// populated and so needs no extra API call to check it.
//
// A THIRD marker lives here too — the "Information" (🗺) forum tag — because
// the wipe has to agree on it in exactly the same way, even though nothing
// toggles it by hand. See INFORMATION_TAG_NAME below.
//
// Pure: no prisma, no REST, safe to import from either side.

const PERSISTENT_TAG_NAME = "Persistent";
const PERSISTENT_EMOJI = "⏰";
const PERSISTENT_PREFIX = `${PERSISTENT_EMOJI} `;

// Stronger than Persistent, and deliberately not the same thing. A ⏰ post
// SURVIVES the Dawn wipe but has every message inside it deleted — fine for a
// standing side-room, useless for a post whose entire point is the text in it.
// A 🗺 post is skipped by the wipe outright: not deleted, not cleared.
//
// Applied only by db/lib/syncLocations.js, to the one generated
// "{Location}: Description" post per -public forum. /persistent never sets it,
// so there is no player-facing way to make a post un-wipeable — which is the
// point, since the tag's whole meaning is "this is generated, the sync owns
// it".
const INFORMATION_TAG_NAME = "Information";
const INFORMATION_EMOJI = "🗺";

// Discord caps a thread name at 100 characters. Adding the prefix has to fit
// inside that, so the tail is trimmed rather than the rename failing.
const THREAD_NAME_MAX = 100;

// Lenient about the trailing space on purpose: a GM who renames a thread by
// hand and types "⏰Plotting" rather than "⏰ Plotting" still gets a thread
// that survives the wipe.
function isPersistentThreadName(name) {
  return typeof name === "string" && name.trimStart().startsWith(PERSISTENT_EMOJI);
}

// Idempotent — prefixing an already-prefixed name returns it unchanged, so a
// double toggle can't stack "⏰ ⏰ ".
function withPersistentPrefix(name) {
  const current = (name ?? "").trim();
  if (isPersistentThreadName(current)) return current;
  return `${PERSISTENT_PREFIX}${current}`.slice(0, THREAD_NAME_MAX);
}

// Idempotent in the other direction. Strips the emoji and any whitespace that
// followed it; a thread whose whole name was the marker falls back to
// something rather than an empty string, which Discord rejects.
function withoutPersistentPrefix(name) {
  const current = (name ?? "").trim();
  if (!isPersistentThreadName(current)) return current;
  const stripped = current.trimStart().slice(PERSISTENT_EMOJI.length).trim();
  return stripped || "thread";
}

module.exports = {
  PERSISTENT_TAG_NAME,
  INFORMATION_TAG_NAME,
  INFORMATION_EMOJI,
  PERSISTENT_EMOJI,
  PERSISTENT_PREFIX,
  isPersistentThreadName,
  withPersistentPrefix,
  withoutPersistentPrefix,
};
