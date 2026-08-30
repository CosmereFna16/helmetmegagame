// "The bot asked this player a question, and the next DM they send is the
// answer" — a one-entry-per-user note the DM logger reads so a prompt reply
// isn't filed as a message to the GMs.
//
// The only producer today is the ✏️ edit reaction
// (bot/src/events/messageReactionAdd.js), whose 60-second awaitMessages
// collector eats the reply for its own purposes; the GM desks were counting it
// as unread player mail regardless. /conceal's prompt is already a
// system_notice and the player retypes in the channel, not in DM.
//
// In-memory on purpose: there is one bot process, the window is 60 seconds,
// and a restart mid-prompt degrades to `source: "player"` — the old behaviour,
// not a new failure.

// Matches the ✏️ collector's own 60s timeout, so the note can't outlive the
// prompt it belongs to.
const PROMPT_TTL_MS = 60_000;

// DirectMessage.source written for a reply to one of these prompts. Web's
// withoutDmNoise excludes it, which is the whole point.
const PROMPT_REPLY_SOURCE = "prompt_reply";

const pending = new Map();

// Call BEFORE sending the prompt DM: the reply can't exist until the prompt
// does, but the reply and the send racing is exactly the bug this avoids.
function expectReply(userId, purpose) {
  pending.set(userId, { purpose, expiresAt: Date.now() + PROMPT_TTL_MS });
}

// Returns the purpose string and forgets it — one prompt, one reply. Null when
// nothing is pending or the note has aged out (the map is swept lazily here
// rather than on a timer; at most one stale entry per user).
function takeReply(userId) {
  const entry = pending.get(userId);
  if (!entry) return null;
  pending.delete(userId);
  return entry.expiresAt > Date.now() ? entry.purpose : null;
}

module.exports = { expectReply, takeReply, PROMPT_REPLY_SOURCE, PROMPT_TTL_MS };
