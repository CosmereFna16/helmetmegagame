// Everything that turns docs/systemdocs/infochannel.yaml into the text that
// lands in #info: the YAML load, the `generated:` bodies, the directory
// message, and finding the channel itself. No writes live here.
//
// Two scripts share it. db/scripts/sync/sync-info-channel.js edits what is
// already posted, and is the one to reach for; db/scripts/sync/
// rebuild-info-channel.js throws the channel away and reposts. See
// docs/systemdocs/INFOCHANNEL.md.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { getGuildChannels, fetchAllMessages, bulkDeleteMessages } = require("./discordRest");
const { ROLE_GROUPS, ROLE_GROUP_OVERRIDES } = require("./roleGroups");
const { docsPath } = require("./repoPaths");

const YAML_PATH = docsPath("systemdocs", "infochannel.yaml");
const ROLES_YAML_PATH = docsPath("roles.yaml");
const DOCS_DIR = docsPath();

// Generator for infochannel.yaml's `generated: roles-intro` thread — the
// Fates thread. Every fate, name + intro text only (no description, tags or
// difficulty), grouped exactly the way /character's picker groups them: the
// seven social buckets of db/lib/roleGroups.js, imported rather than
// duplicated so the thread and the picker can never disagree.
//
// It names NO ZONE, on purpose. This used to head each section with a big
// "# Black Hills", which told every reader where the Brigands camp before the
// game had started. The bucket is a social position, not a place.
//
// A fate whose faction is whitelisted-only wears a ★ — that is `whitelist:`,
// the thing that actually gates the seat, not `leader:`. Bolded names are the
// two high-cap, go-anywhere fates; everything else is italic.
// Reads roles.yaml fresh every run, so this thread can never drift from it.
const BOLD_ROLE_NAMES = new Set(["Commoner", "Migrant"]);

// "The Court" under a "Court" heading is just the heading again. Compared
// normalized so the faction line is skipped there and kept everywhere it
// carries something new ("The Sanctuary" under Saviors).
function sameName(a, b) {
  const strip = (v) => String(v ?? "").trim().toLowerCase().replace(/^the\s+/, "");
  return strip(a) === strip(b);
}

function buildRolesIntroBody() {
  const rolesDoc = yaml.load(fs.readFileSync(ROLES_YAML_PATH, "utf8"));

  const bucketOf = new Map();
  for (const group of ROLE_GROUPS) {
    for (const slug of group.factionSlugs) bucketOf.set(slug, group.slug);
  }
  const ELSEWHERE = "other";
  const order = [...ROLE_GROUPS, { slug: ELSEWHERE, name: "Elsewhere" }];
  // bucket slug -> ordered list of { factionName, lines }, one per faction
  const held = new Map(order.map((g) => [g.slug, []]));

  // `factions` and `roles` are slug-keyed MAPPINGS in roles.yaml, not lists —
  // db/lib/syncRoles.js reads them the same way.
  for (const zone of rolesDoc.zones ?? []) {
    for (const [factionSlug, faction] of Object.entries(zone.factions ?? {})) {
      const home = bucketOf.get(factionSlug) ?? ELSEWHERE;
      for (const [roleSlug, role] of Object.entries(faction.roles ?? {})) {
        // Same precedence groupRoles applies: a role may override its
        // faction's bucket, which is how the Fisherman reads as Soil.
        const wanted = ROLE_GROUP_OVERRIDES[roleSlug] ?? home;
        const bucket = held.has(wanted) ? wanted : ELSEWHERE;
        const marker = BOLD_ROLE_NAMES.has(role.name) ? "**" : "*";
        const whitelistMark = role.whitelist === true ? " (★)" : "";
        const line = `${marker}${role.name}${marker}${whitelistMark} — ${role.intro}`;

        const sections = held.get(bucket);
        let section = sections.find((s) => s.factionName === faction.name);
        if (!section) {
          section = { factionName: faction.name, lines: [] };
          sections.push(section);
        }
        section.lines.push(line);
      }
    }
  }

  // A heading is followed straight by its content; blank lines only ever
  // separate one group from the next.
  return order
    .filter((group) => held.get(group.slug).length > 0)
    .map((group) => {
      const sections = held.get(group.slug).map((section) =>
        sameName(section.factionName, group.name)
          ? section.lines.join("\n")
          : [`***${section.factionName}***`, ...section.lines].join("\n"),
      );
      return `# ${group.name}\n${sections.join("\n\n")}`;
    })
    .join("\n\n");
}

const GENERATORS = { "roles-intro": buildRolesIntroBody };

function loadInfoDoc() {
  return yaml.load(fs.readFileSync(YAML_PATH, "utf8"));
}

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

// Every thread the YAML names, flattened out of its categories, in order.
function infoThreads(doc) {
  return (doc.categories ?? []).flatMap((category) => category.threads ?? []);
}

async function findInfoChannel() {
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.type === 0 && c.name?.toLowerCase() === "info");
  if (!channel) throw new Error('No text channel named "info" found in this guild.');
  return channel;
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

module.exports = {
  YAML_PATH,
  DOCS_DIR,
  BOLD_ROLE_NAMES,
  GENERATORS,
  loadInfoDoc,
  resolveThreadBody,
  infoThreads,
  findInfoChannel,
  LINKS_LINE,
  buildDirectoryMessage,
  THREAD_CREATED_MESSAGE_TYPE,
  deleteThreadCreatedMessages,
};
