// Manual, terminal-invoked wipe+rebuild of #info from
// docs/systemdocs/infochannel.yaml. Run with `npm run db:rebuild-info-channel`.
// Never runs automatically (no cron, no per-turn hook) — same explicit-push
// convention as sync-locations.js.
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
  postAttachment,
} = require("../../lib/discordRest");
const { docsPath } = require("../../lib/repoPaths");

// Through docsPath(), not a count of "..": this file moved into
// db/scripts/sync/ and its hops were never re-counted, so it had been looking
// in a db/docs/ that does not exist and dying on ENOENT ever since.
const YAML_PATH = docsPath("systemdocs", "infochannel.yaml");
const ROLES_YAML_PATH = docsPath("roles.yaml");
const DOCS_DIR = docsPath();

// Generator for infochannel.yaml's `generated: roles-intro` thread: every
// faction's roles (name + intro text only — no description/tags/difficulty,
// and zone-level `threats` are skipped entirely), grouped under a bold
// faction heading, itself grouped under a Discord "# " (native big-text)
// zone heading, in docs/roles.yaml's zone -> faction -> role order. A role
// flagged `leader: true` gets a ★ marker next to its name.
// Reads roles.yaml fresh every run, so this thread can never drift from it.
// Higher-cap, more generalized roles get called out in bold in the roles-intro
// thread (see the "Bolded roles" blurb in infochannel.yaml) instead of the
// default italics.
const BOLD_ROLE_NAMES = new Set([
  "Courtier",
  "Watchman",
  "Commoner",
  "Follower",
  "Clansman (Broken Spears Clan)",
  "Clansman (Windrider Clan)",
  "Migrant",
]);

function buildRolesIntroBody() {
  const rolesDoc = yaml.load(fs.readFileSync(ROLES_YAML_PATH, "utf8"));

  // `factions` and `roles` are slug-keyed MAPPINGS in roles.yaml, not lists —
  // db/lib/syncRoles.js reads them the same way. This walked them as arrays
  // and threw "object is not iterable" the moment it got far enough to try,
  // which it never did while the YAML path above was also wrong.
  const zoneSections = [];
  for (const zone of rolesDoc.zones ?? []) {
    const factionSections = [];
    for (const faction of Object.values(zone.factions ?? {})) {
      const roleLines = Object.values(faction.roles ?? {}).map((role) => {
        const leaderMark = role.leader === true ? " (★)" : "";
        const marker = BOLD_ROLE_NAMES.has(role.name) ? "**" : "*";
        return `${marker}${role.name}${marker}${leaderMark} — ${role.intro}`;
      });
      if (roleLines.length === 0) continue;
      factionSections.push(`***${faction.name}***\n${roleLines.join("\n")}`);
    }
    if (factionSections.length === 0) continue;
    zoneSections.push([`# ${zone.name}`, ...factionSections].join("\n\n"));
  }

  return zoneSections.join("\n\n");
}

const GENERATORS = { "roles-intro": buildRolesIntroBody };

// A thread's body is its hand-authored `body` (if any), followed by its
// generator's output (if any) — lets a `generated` thread carry a static
// intro paragraph (e.g. Roles' "choose a role at game start..." blurb)
// ahead of the auto-built content.
function resolveThreadBody(thread) {
  const parts = [];
  if (thread.body) parts.push(thread.body);
  if (thread.generated) parts.push(GENERATORS[thread.generated]());
  return parts.join("\n\n");
}

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

const LINKS_LINE =
  "[Website](http://ravenheart.quest/) | [Handbook](http://ravenheart.quest/handbook)";

function buildDirectoryMessage(mainMessage, linksByCategory) {
  const sections = linksByCategory.map((category) => {
    const heading = category.name ? `**${category.name}**` : null;
    const lines = category.threadIds.map((id) => `<#${id}>`);
    const body = [category.intro, lines.join("\n")].filter(Boolean).join("\n");
    return [heading, body].filter(Boolean).join("\n");
  });
  return [mainMessage, ...sections, LINKS_LINE].join("\n\n");
}

async function main() {
  const doc = yaml.load(fs.readFileSync(YAML_PATH, "utf8"));

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
