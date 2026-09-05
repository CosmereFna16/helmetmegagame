// Manual, terminal-invoked wipe+rebuild of #info from
// docs/systemdocs/infochannel.yaml. Run with `npm run db:rebuild-info-channel`.
// Never runs automatically (no cron, no per-turn hook) — same explicit-push
// convention as sync-locations.js.
//
// This is the DESTRUCTIVE one, and it is no longer the default: every run
// deletes every message and every thread on the channel, then rebuilds from
// scratch, which notifies everyone following a thread. Reach for
// `npm run db:sync-info-channel` instead, which edits what is already there.
// This one is for when the channel's ORDER is wrong, or somebody has made a
// mess of it — those are the two things an in-place edit cannot fix.
//
// The content half (YAML, generators, directory message) lives in
// db/lib/infoChannel.js, shared with that script. See
// docs/systemdocs/INFOCHANNEL.md for the full mechanism writeup.
require("dotenv").config();
const path = require("node:path");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  startThread,
  postMessageBatched,
  postAttachment,
} = require("../../lib/discordRest");
const {
  DOCS_DIR,
  loadInfoDoc,
  resolveThreadBody,
  findInfoChannel,
  buildDirectoryMessage,
  deleteThreadCreatedMessages,
} = require("../../lib/infoChannel");

async function wipeChannel(channelId) {
  const messages = await fetchAllMessages(channelId);
  if (messages.length > 0) await bulkDeleteMessages(channelId, messages.map((m) => m.id));
  console.log(`  deleted ${messages.length} message(s)`);

  const active = await listActiveThreadsForChannel(channelId);
  const archivedPublic = await listArchivedPublicThreads(channelId);
  const archivedPrivate = await listArchivedPrivateThreads(channelId);
  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  const threads = [...byId.values()];

  for (const thread of threads) await deleteThread(thread.id);
  console.log(`  deleted ${threads.length} thread(s)`);
}

async function createThreads(channelId, categories) {
  const linksByCategory = [];

  for (const category of categories) {
    const links = [];
    for (const thread of category.threads) {
      const created = await startThread(channelId, thread.title);
      await postMessageBatched(created.id, resolveThreadBody(thread));
      console.log(`  created thread: ${thread.title}`);
      links.push(created.id);
    }
    linksByCategory.push({
      name: category.name,
      intro: category.intro,
      threadIds: links,
      titles: category.threads.map((t) => t.title),
    });
  }

  return linksByCategory;
}

async function main() {
  const doc = loadInfoDoc();

  const channel = await findInfoChannel();
  console.log(`Found #info (${channel.id})`);

  console.log("Wiping #info...");
  await wipeChannel(channel.id);

  // Posted before the threads are created, not just before the directory
  // message: Discord orders a channel oldest-first, and thread creation
  // itself emits system messages into the timeline. Going first is the only
  // way the banner is guaranteed to sit above everything else in #info.
  if (doc.banner) {
    console.log("Posting banner...");
    await postAttachment(channel.id, path.join(DOCS_DIR, doc.banner));
  }

  console.log("Creating threads...");
  const linksByCategory = await createThreads(channel.id, doc.categories);

  console.log("Posting directory message...");
  const directoryMessage = buildDirectoryMessage(doc.main_message, linksByCategory);
  await postMessageBatched(channel.id, directoryMessage);

  console.log("Cleaning up thread-created system messages...");
  await deleteThreadCreatedMessages(channel.id);

  const threadCount = linksByCategory.reduce((sum, c) => sum + c.threadIds.length, 0);
  console.log(`Done: ${linksByCategory.length} categor(y/ies), ${threadCount} thread(s) posted to #info.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
