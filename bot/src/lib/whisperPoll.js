const { concealedAlias } = require("@lifeweb/db");
const { postMessage } = require("@lifeweb/db/lib/discordRest");

// Every 15 minutes, each Room hears who has been whispering in the
// Conversations linked to it — "A young man and an old woman are whispering…"
// — and never who they are. That is the whole trade the feature exists for:
// a private thread is genuinely private, but the room it happens in knows
// somebody is having it.
//
// Everyone is aliased, concealed or not (db/lib/concealedIdentity.js). The
// room learns an age and a presentation, which is what standing across a
// tavern tells you, and nothing else.
//
// Stateless: one 15-minute lookback per tick, no cursor column. A restart
// across a tick may double-post a line or skip one, which is cheaper than a
// row of bookkeeping for flavor text.

const WINDOW_MINUTES = 15;
// Past this many, the line stops being informative and starts being a wall.
const MAX_NAMED = 5;

function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Oxford comma throughout, and a hard stop at MAX_NAMED so a crowded thread
// reads as a crowd instead of a roster.
function joinAliases(aliases) {
  if (aliases.length === 1) return aliases[0];
  if (aliases.length === 2) return `${aliases[0]} and ${aliases[1]}`;
  if (aliases.length <= MAX_NAMED) {
    return `${aliases.slice(0, -1).join(", ")}, and ${aliases[aliases.length - 1]}`;
  }
  return `${aliases.slice(0, MAX_NAMED).join(", ")}, and others`;
}

// ArchiveEntry.discordChannelId already holds the THREAD id for a proxied
// message, indexed with sentAt — so "who spoke in here lately" is one query
// over a table that already exists, and the poll needs no table of its own.
async function runWhisperPoll(prisma) {
  const conversations = await prisma.playerThread.findMany({
    where: { roomId: { not: null } },
    select: { threadId: true, room: { select: { discordThreadId: true } } },
  });
  if (conversations.length === 0) return 0;

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const entries = await prisma.archiveEntry.findMany({
    where: {
      kind: "MESSAGE",
      sentAt: { gte: since },
      discordChannelId: { in: conversations.map((c) => c.threadId) },
      characterId: { not: null },
    },
    select: { discordChannelId: true, characterId: true },
    distinct: ["discordChannelId", "characterId"],
  });
  if (entries.length === 0) return 0;

  const byThread = new Map();
  for (const entry of entries) {
    const list = byThread.get(entry.discordChannelId) ?? [];
    list.push(entry.characterId);
    byThread.set(entry.discordChannelId, list);
  }

  const speakers = new Map(
    (
      await prisma.character.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.characterId))] } },
        select: { id: true, age: true, gender: true },
      })
    ).map((c) => [c.id, c]),
  );

  let posted = 0;
  for (const conversation of conversations) {
    const speakerIds = byThread.get(conversation.threadId);
    // Nobody spoke, or the linked room was never provisioned a thread.
    if (!speakerIds?.length || !conversation.room?.discordThreadId) continue;

    const aliases = speakerIds.map((id) =>
      withArticle(concealedAlias(speakers.get(id) ?? {}).toLowerCase()),
    );
    const verb = speakerIds.length === 1 ? "is" : "are";
    const line = `*${capitalizeFirst(joinAliases(aliases))} ${verb} whispering…* ‡`;

    // Sequential and catch-logged: one unreachable room must not stop the
    // rest of the tick, and a burst of parallel posts is what trips the
    // invalid-response breaker.
    try {
      await postMessage(conversation.room.discordThreadId, line);
      posted += 1;
    } catch (err) {
      console.error(`Whisper post to ${conversation.room.discordThreadId} failed:`, err.message ?? err);
    }
  }
  return posted;
}

module.exports = { runWhisperPoll, WINDOW_MINUTES };
