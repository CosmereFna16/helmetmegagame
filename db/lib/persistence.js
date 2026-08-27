// The two forum tag names, in the one place the Dawn wipe, the sync and the
// /persistent command can agree on them. Pure: no prisma, no REST.
//
// "Persistent" — a player-made topic that survives the Dawn wipe (its
// messages are still cleared). Since the zone rework the SOURCE OF TRUTH for
// persistence is PlayerThread.persistent in the DB; the forum tag is a
// visible mirror on public posts, re-asserted by the wipe, and a private
// thread carries no marker at all. The old ⏰ name-prefix (and its
// 2-renames-per-10-minutes rate limit) is gone.
//
// "Location" — stronger than Persistent, and deliberately not the same
// thing. A Persistent post survives the wipe but is EMPTIED; a Location post
// keeps its starter message forever and only its replies are cleared. Applied
// only by db/lib/syncZones.js to the generated Location topics and the
// "Create a Topic" anchor posts. /persistent refuses to touch a post the
// sync owns — checked against the recorded thread ids, not this tag, so a
// hand-stripped tag opens no hole.
//
// Neither tag carries an emoji, on purpose.

const PERSISTENT_TAG_NAME = "Persistent";
const LOCATION_TAG_NAME = "Location";

module.exports = {
  PERSISTENT_TAG_NAME,
  LOCATION_TAG_NAME,
};
