// Manual, terminal-invoked wipe+rebuild of #info from
// docs/systemdocs/infochannel.yaml. Run with `npm run db:rebuild-info-channel`.
// Never runs automatically (no cron, no per-turn hook) — same explicit-push
// convention as sync-locations.js/sync-production-doc.js.
//
// Unlike those two scripts, this is NOT an upsert: #info carries no
// player-generated content worth preserving, so every run deletes every
// message and every thread on the channel, then rebuilds it from scratch —
// one standalone thread per infochannel.yaml entry, plus a directory
// message (the YAML's main_message, followed by a generated per-category
// listing of thread-mention links). See docs/systemdocs/INFOCHANNEL.md for
// the full mechanism writeup.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  getGuildChannels,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  startThread,
  postMessageBatched,
} = require("../lib/discordRest");

const YAML_PATH = path.join(__dirname, "..", "..", "docs", "systemdocs", "infochannel.yaml");

async function findInfoChannel() {
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.type === 0 && c.name?.toLowerCase() === "info");
  if (!channel) throw new Error('No text channel named "info" found in this guild.');
  return channel;
}

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
      await postMessageBatched(created.id, thread.body);
      console.log(`  created thread: ${thread.title}`);
      links.push(created.id);
    }
    linksByCategory.push({ name: category.name, threadIds: links, titles: category.threads.map((t) => t.title) });
  }

  return linksByCategory;
}

// Creating a thread with no starter message (as startThread does) makes
// Discord auto-post a "X started a thread: Y" system message (type 18,
// THREAD_CREATED) into the parent channel — one per thread, pure clutter
// around the directory message. Swept up after everything else is posted
// so only the real content messages (directory + any batched overflow)
// remain.
const THREAD_CREATED_MESSAGE_TYPE = 18;

async function deleteThreadCreatedMessages(channelId) {
  const messages = await fetchAllMessages(channelId);
  const systemMessages = messages.filter((m) => m.type === THREAD_CREATED_MESSAGE_TYPE);
  if (systemMessages.length > 0) await bulkDeleteMessages(channelId, systemMessages.map((m) => m.id));
  console.log(`  cleaned up ${systemMessages.length} "started a thread" system message(s)`);
}

function buildDirectoryMessage(mainMessage, linksByCategory) {
  const sections = linksByCategory.map((category) => {
    const lines = category.threadIds.map((id) => `<#${id}>`);
    return `***${category.name}:***\n${lines.join("\n")}`;
  });
  return [mainMessage, ...sections].join("\n\n");
}

async function main() {
  const doc = yaml.load(fs.readFileSync(YAML_PATH, "utf8"));

  const channel = await findInfoChannel();
  console.log(`Found #info (${channel.id})`);

  console.log("Wiping #info...");
  await wipeChannel(channel.id);

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
