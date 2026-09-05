// In-place sync of #info from docs/systemdocs/infochannel.yaml. Run with
// `npm run db:sync-info-channel`. This is the one to reach for.
//
// The old rebuild deletes every message and every thread and posts them all
// again, which pings everyone following a thread for the sake of a typo fix.
// Discord sends no notification for an EDIT, so this script edits: it matches
// what is live against the YAML, rewrites the bodies that changed, creates
// only threads that are genuinely new, and leaves everything else untouched.
//
// THE MATCH KEY IS THE THREAD TITLE. Nothing persists a Discord message or
// thread id — #info has no DB row of any kind — and the title is the thing a
// GM edits deliberately, so it plays the part `slug` plays in every other
// sync. Rename a thread in the YAML and this reads as "a new thread, plus an
// orphan", which is reported rather than guessed at.
//
// The one thing it cannot do is REORDER. Threads keep the position Discord
// gave them, so moving an entry up in the YAML changes the directory listing
// and not the sidebar. That is the trade for a silent run; when the order
// itself is wrong, `npm run db:rebuild-info-channel` is still there.
//
// Flags:
//   --dry-run   print the plan, write nothing
//   --prune     delete threads the YAML no longer names (reported otherwise)
require("dotenv").config();
const path = require("node:path");
const {
  discordRequest,
  fetchAllMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  patchThread,
  startThread,
  postMessage,
  postMessageBatched,
  postAttachment,
  editMessage,
  deleteMessage,
  chunkMessage,
} = require("../../lib/discordRest");
const {
  DOCS_DIR,
  loadInfoDoc,
  resolveThreadBody,
  infoThreads,
  findInfoChannel,
  buildDirectoryMessage,
  deleteThreadCreatedMessages,
} = require("../../lib/infoChannel");

const DRY_RUN = process.argv.includes("--dry-run");
const PRUNE = process.argv.includes("--prune");

// Editing somebody else's message is impossible and deleting one would be
// rude, so every reconcile below is scoped to messages the bot itself wrote.
// DISCORD_CLIENT_ID is the bot's user id — db/lib/channelDoctor.js reads it
// the same way — with /users/@me as the fallback for a .env that lacks it.
let botUserId = null;
async function getBotUserId() {
  if (botUserId) return botUserId;
  botUserId = process.env.DISCORD_CLIENT_ID || null;
  if (!botUserId) botUserId = (await discordRequest("/users/@me")).id;
  return botUserId;
}

async function ownMessages(channelId) {
  const me = await getBotUserId();
  const messages = await fetchAllMessages(channelId);
  return messages.filter((m) => m.author?.id === me);
}

// Rewrites `channelId` so the bot's own messages there read exactly `text`,
// chunked the way postMessageBatched would have posted it. Chunk i is edited
// onto existing message i, a chunk with no message to land on is posted, and
// any surplus message past the last chunk is deleted. Identical content is
// left completely alone — a no-op run should cost nothing and change no
// message's "(edited)" mark.
async function reconcileMessages(channelId, text, existing, label) {
  const chunks = chunkMessage(text);
  let edited = 0;
  let posted = 0;
  let deleted = 0;

  for (let i = 0; i < chunks.length; i++) {
    const message = existing[i];
    if (!message) {
      if (!DRY_RUN) await postMessage(channelId, chunks[i]);
      posted += 1;
      continue;
    }
    if (message.content === chunks[i]) continue;
    if (!DRY_RUN) await editMessage(channelId, message.id, chunks[i]);
    edited += 1;
  }

  for (const message of existing.slice(chunks.length)) {
    if (!DRY_RUN) await deleteMessage(channelId, message.id);
    deleted += 1;
  }

  const changes = [
    edited ? `${edited} edited` : null,
    posted ? `${posted} posted` : null,
    deleted ? `${deleted} deleted` : null,
  ].filter(Boolean);
  console.log(`  ${label}: ${changes.length > 0 ? changes.join(", ") : "unchanged"}`);
  return changes.length > 0;
}

async function liveThreadsByTitle(channelId) {
  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = await listArchivedPublicThreads(channelId);
  const archivedPrivate = await listArchivedPrivateThreads(channelId);

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);

  const byTitle = new Map();
  for (const thread of byId.values()) byTitle.set(String(thread.name ?? "").trim().toLowerCase(), thread);
  return { byId, byTitle };
}

function assertUniqueTitles(doc) {
  const seen = new Set();
  const duplicates = [];
  for (const thread of infoThreads(doc)) {
    const key = String(thread.title ?? "").trim().toLowerCase();
    if (seen.has(key)) duplicates.push(thread.title);
    seen.add(key);
  }
  // Matching is by title, so two threads sharing one would quietly overwrite
  // each other. Fail before touching Discord rather than halfway through it.
  if (duplicates.length > 0) {
    throw new Error(`infochannel.yaml has duplicate thread titles: ${duplicates.join(", ")}`);
  }
}

async function main() {
  const doc = loadInfoDoc();
  assertUniqueTitles(doc);

  const channel = await findInfoChannel();
  console.log(`Found #info (${channel.id})${DRY_RUN ? " — DRY RUN, nothing will be written" : ""}`);

  const { byId, byTitle } = await liveThreadsByTitle(channel.id);
  const matchedIds = new Set();
  let created = 0;

  const linksByCategory = [];
  for (const category of doc.categories ?? []) {
    const threadIds = [];
    for (const entry of category.threads ?? []) {
      const key = String(entry.title ?? "").trim().toLowerCase();
      const live = byTitle.get(key);
      const body = resolveThreadBody(entry);

      if (!live) {
        console.log(`  ${entry.title}: NEW thread`);
        created += 1;
        if (!DRY_RUN) {
          const made = await startThread(channel.id, entry.title);
          await postMessageBatched(made.id, body);
          threadIds.push(made.id);
        }
        continue;
      }

      matchedIds.add(live.id);
      threadIds.push(live.id);
      // You cannot post into or edit inside an archived thread, so wake it
      // first. Unarchiving notifies nobody.
      if (live.thread_metadata?.archived && !DRY_RUN) {
        await patchThread(live.id, { archived: false });
      }
      await reconcileMessages(live.id, body, await ownMessages(live.id), entry.title);
    }
    linksByCategory.push({ name: category.name, intro: category.intro, threadIds });
  }

  // A thread nothing in the YAML names any more. The directory stops linking
  // it either way, so leaving it costs nothing — deleting somebody's thread
  // should be asked for, not assumed.
  const orphans = [...byId.values()].filter((t) => !matchedIds.has(t.id));
  for (const thread of orphans) {
    if (PRUNE) {
      if (!DRY_RUN) await deleteThread(thread.id);
      console.log(`  ${thread.name}: pruned (not in infochannel.yaml)`);
    } else {
      console.log(`  ${thread.name}: not in infochannel.yaml — leaving it (--prune deletes)`);
    }
  }

  // Top-level messages: the banner (an attachment) plus the directory text.
  // An attachment cannot be edited in place and reposting it is exactly the
  // notification this script exists to avoid, so it is only ever posted when
  // #info has no attachment at all.
  const topLevel = await ownMessages(channel.id);
  if (doc.banner && !topLevel.some((m) => (m.attachments?.length ?? 0) > 0)) {
    console.log("  banner: posting (none present)");
    if (!DRY_RUN) await postAttachment(channel.id, path.join(DOCS_DIR, doc.banner));
  }

  const directoryMessage = buildDirectoryMessage(doc.main_message, linksByCategory);
  const directoryMessages = topLevel.filter((m) => (m.attachments?.length ?? 0) === 0);
  await reconcileMessages(channel.id, directoryMessage, directoryMessages, "directory message");

  // Only a brand new thread leaves one of these behind, so this is usually a
  // no-op — but it is cheap and it keeps the channel clean.
  if (created > 0 && !DRY_RUN) await deleteThreadCreatedMessages(channel.id);

  const threadCount = linksByCategory.reduce((sum, c) => sum + c.threadIds.length, 0);
  console.log(
    `Done: ${threadCount} thread(s) in #info, ${created} created, ${orphans.length} not in the YAML.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
