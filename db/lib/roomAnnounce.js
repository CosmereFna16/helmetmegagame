// One line in a Room's thread saying somebody did something to its stash,
// aliased the way the whisper poll aliases a speaker — "An old woman leaves
// Graga Sac ×3 here." The room learns an age and a presentation, never a
// name; anyone standing there can read the thread and act on it, which is
// what a public floor is for (docs/systemdocs/CARRY.md).
//
// REST, best-effort, catch-logged: a missed line is flavour lost, never a
// failed transfer. Never call this inside a transaction.
const { postMessage } = require("./discordRest");
const { aliasSubject } = require("./concealedIdentity");
const { ambientLine } = require("./ambientLine");

// `room` needs { discordThreadId, name }; `character` needs { age, gender }.
// `text` is the predicate ("leaves Graga Sac ×3 here."); `lines` are extra
// quoted lines under it. Formatting is ambientLine's job, not this file's.
async function announceInRoom(room, character, text, lines = []) {
  if (!room?.discordThreadId) return;
  const content = ambientLine(`${aliasSubject(character)} ${text}`, lines);
  await postMessage(room.discordThreadId, content).catch((err) =>
    console.error(`Room stash announcement failed (${room.name ?? room.discordThreadId}):`, err.message),
  );
}

module.exports = { announceInRoom };
