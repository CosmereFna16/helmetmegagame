// The three forum tag names, in the one place the Dawn wipe, the sync, the
// /persistent command and the Quest conversion can agree on them. Pure: no
// prisma, no REST.
//
// SOURCE OF TRUTH for persistence is PlayerThread.persistent in the DB; each
// tag is a visible mirror, re-asserted by the wipe. "Persistent" survives the
// wipe but is emptied; "Location" (set only by db/lib/syncZones.js) and
// "Quest" (a GM post, converted by bot/src/lib/questPost.js) keep their
// starter message forever and only clear replies. /persistent checks recorded
// thread ids, not the tag, before touching a sync-owned post.

const PERSISTENT_TAG_NAME = "Persistent";
const LOCATION_TAG_NAME = "Location";
const QUEST_TAG_NAME = "Quest";

module.exports = {
  PERSISTENT_TAG_NAME,
  LOCATION_TAG_NAME,
  QUEST_TAG_NAME,
};
