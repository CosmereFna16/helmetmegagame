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
// Pure: no prisma, no REST, safe to import from either side.

const PERSISTENT_TAG_NAME = "Persistent";
const PERSISTENT_EMOJI = "⏰";
const PERSISTENT_PREFIX = `${PERSISTENT_EMOJI} `;

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
  PERSISTENT_EMOJI,
  PERSISTENT_PREFIX,
  isPersistentThreadName,
  withPersistentPrefix,
  withoutPersistentPrefix,
};
