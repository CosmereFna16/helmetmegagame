// What counts as player-facing copy, and where it goes in the worksheets.
//
// This is the one file to edit when the extractor misses something or picks up
// noise. Nothing in web/, bot/ or db/ imports it — the copy tooling is an
// authoring aid that never ships.

// ---------------------------------------------------------------------------
// YAML masters
// ---------------------------------------------------------------------------
// `keys` are the prose-bearing key names to pull. A key whose value is a
// sequence yields one entry per element. Everything else in the file —
// mechanics fields, and the long authoring comment blocks these files carry —
// is left strictly alone: reinjection splices single scalars back by byte
// offset rather than re-serializing, so comments survive untouched.

const YAML_SOURCES = [
  {
    file: "docs/tags.yaml",
    group: "content-tags",
    keys: ["description"],
    where: "Tag description — tag chips and hovercards on the web sheet, the point-buy picker, /api/tags.",
  },
  {
    file: "docs/roles.yaml",
    group: "content-roles",
    keys: ["intro", "description", "situation"],
    where: {
      intro: "Role intro — the one-line pitch in the character creation wizard, and the Roles thread in #info.",
      description: "Role charter bullet — rendered as one Markdown bullet on the role card in /documents.",
      situation: "Zone situation — opening-state prose for the zone.",
    },
  },
  {
    file: "docs/documents.yaml",
    group: "content-documents",
    keys: ["description"],
    where: "In-game document body (Markdown) — the card and reader on /documents.",
  },
  {
    file: "docs/systemdocs/infochannel.yaml",
    group: "content-infochannel",
    keys: ["main_message", "body"],
    where: "Discord #info. Rebuilt by a full destructive wipe-and-repost (npm run db:rebuild-info-channel).",
  },
  {
    file: "docs/zones.yaml",
    group: "content-zones",
    keys: ["description"],
    where:
      "Zone blurb (heads the Create-a-Topic post) or Location topic prose (the topic's starter message).",
  },
  {
    file: "docs/taggroups.yaml",
    group: "content-taggroups",
    keys: ["name"],
    where: "Tag group name — the tinted heading a tag chip is grouped under.",
  },
];

// ---------------------------------------------------------------------------
// JavaScript sources
// ---------------------------------------------------------------------------

// Directories walked for inline copy.
const JS_ROOTS = ["web/app", "web/lib", "bot/src", "db/lib", "db/weather.js"];

// Never walked. `.claude/worktrees` holds stale duplicate checkouts of bot/
// and db/ that a repo-wide pass would otherwise rewrite as well.
const IGNORE_DIRS = [
  ".claude",
  "node_modules",
  ".next",
  ".git",
  "worksheets",
  "generated",
];

// Files that score high on a naive string grep but carry no player-facing
// text: API paths, name corpora, and CLI console output from the sync scripts.
const IGNORE_FILES = [
  "db/lib/discordRest.js",
  "db/lib/nameCorpus.js",
  // Every entry is a single catalog word (Sir, Lady, Constable) that scores
  // as copy and isn't — same reasoning as the name corpus above. The prose
  // that explains titles to a player lives in the pickers, not here.
  "db/lib/titles.js",
  "db/lib/syncTags.js",
  "db/lib/pruneTags.js",
  "db/lib/syncZones.js",
  "db/lib/syncRoles.js",
  "db/lib/syncDocuments.js",
  "db/lib/archive.js",
  "db/lib/persistence.js",
  "db/lib/roleIds.js",
  "web/lib/superadmin.js",
];

// JSX props whose string value is always copy, however short.
const COPY_PROPS = new Set([
  "subtitle",
  "hint",
  "placeholder",
  "label",
  "title",
  "message",
  "confirmLabel",
  "cancelLabel",
  "emptyLabel",
  "description",
  "heading",
  "note",
  "helpText",
  "tooltip",
  "aria-label",
]);

// Callee names whose string arguments are copy.
const COPY_CALLS = new Set([
  "UserError",
  "sendDm",
  // The bot's shared responder (bot/src/lib/respond.js). Most handlers now
  // answer through it rather than through interaction.reply, so without this
  // their voice would only be caught incidentally by the loose pass below --
  // which misses anything under LOOSE_MIN_WORDS.
  "respond",
  "confirm",
  "setDescription",
  "setLabel",
  "setPlaceholder",
  "setTitle",
  "setContent",
  "setValue",
  "setCustomMessage",
]);

// Named constants holding copy that no call-site matcher would catch.
const COPY_CONSTANTS = new Set([
  "HUNGER_DM",
  "CONSOLE_TEXT",
  "WEATHER_MESSAGES",
  "REQUEST_TYPE_LABELS",
  "REQUEST_STATUS_LABELS",
]);

// Object keys inside those constants (and inside command definitions) that
// hold copy rather than mechanics.
const COPY_OBJECT_KEYS = new Set(["description", "where", "label", "name", "noun"]);

// discord.js replies carry their text as a `content:` property of an options
// object rather than a positional argument, so the call has to be matched and
// then the property read out of it. This is how essentially all of the bot's
// ephemeral voice is written.
const REPLY_CALLS = new Set([
  "reply",
  "followUp",
  "editReply",
  "update",
  "send",
  "edit",
]);
const REPLY_KEYS = new Set(["content"]);

// Embed builders take their copy as object properties too.
const EMBED_CALLS = new Set(["addFields", "setFooter", "setAuthor"]);
const EMBED_KEYS = new Set(["name", "value", "text"]);

// Roots where a final loose pass picks up prose held in a plain variable —
// the bot composes several of its longest lines that way (db/weather.js's
// turn announcement, for one). The surface is small enough that the noise
// stays manageable; web/ is left to the targeted matchers.
const LOOSE_ROOTS = ["bot/src", "db/"];
const LOOSE_MIN_WORDS = 5;

// Files whose strings render into BOTH Discord and the web panel. The
// worksheet says so on every entry, because rewriting one of these changes
// two faces at once.
const DUAL_SURFACE_FILES = new Set([
  "db/lib/turnFormat.js",
  "db/lib/formatTagRequirement.js",
  "db/lib/moveEffects.js",
  "db/lib/mood.js",
  "db/lib/production.js",
]);

// The `»` rule is per-call-site, not per-file. All three sendDm twins apply
// the prefix automatically, so a hand-written one there doubles up
// (db/lib/defaultMovePass.js:214 carries a comment about exactly this).
// Everywhere else — interaction replies, channel posts, bot-composed DMs that
// pair the line with other formatting — it IS written inline and must stay.
const GUILLEMET_AUTO_KINDS = new Set(["call:sendDm"]);

// ---------------------------------------------------------------------------
// Worksheet grouping — by what the player is looking at, not by directory.
// First matching rule wins.
// ---------------------------------------------------------------------------

const JS_GROUPS = [
  { group: "web-gm", test: (f) => f.includes("/gm/") },
  {
    group: "web-errors",
    test: (f, e) => e.kind === "UserError",
  },
  {
    group: "web-creation",
    test: (f) =>
      /CreateCharacterWizard|CreationClosed|createActions|BioNameFields|PortraitMaker|AvatarField|characterCreation/.test(
        f,
      ),
  },
  {
    group: "web-character",
    test: (f) =>
      f.startsWith("web/app/(app)/character/") ||
      f.startsWith("web/app/components/") ||
      f.startsWith("web/lib/"),
  },
  {
    group: "web-map-faction",
    test: (f) => f.startsWith("web/app/"),
  },
  { group: "bot-commands", test: (f) => f === "bot/src/lib/commands.js" },
  {
    group: "bot-replies",
    test: (f) => f === "bot/src/events/interactionCreate.js",
  },
  {
    group: "bot-turns",
    test: (f) =>
      /turnsConsole|turnAnnouncement|turnEngine|turnFormat|moveModal|moveConfirm|defaultMovePass|hungerPass|tagExpiryPass|weather|labor|travel/i.test(
        f,
      ),
  },
  { group: "bot-misc", test: () => true },
];

// Human-readable header for each worksheet.
const GROUP_TITLES = {
  "content-tags": "Tag descriptions — every tag in the catalog.",
  "content-roles": "Role intros and charters.",
  "content-documents": "In-game documents shown on /documents.",
  "content-infochannel": "The Discord #info channel.",
  "content-locations": "Location descriptions — map nodes and channel topics.",
  "content-taggroups": "Tag group names.",
  "web-character": "Web: the character sheet and its panels.",
  "web-creation": "Web: character creation and the gate screens.",
  "web-map-faction": "Web: /map, /faction, /documents, /notes, /archive chrome.",
  "web-errors": "Web: refusal messages a player sees when an action is blocked.",
  "web-gm": "Web: GM-only pages under /gm.",
  "bot-commands": "Bot: slash command and option descriptions.",
  "bot-replies": "Bot: ephemeral refusals, confirmations and prompts.",
  "bot-turns": "Bot: the #turns console, modals, and turn-cycle DMs.",
  "bot-misc": "Bot: dossier embeds, mentions, proxy and conceal replies.",
};

// Suggested writing order — highest reading-volume first.
const GROUP_ORDER = [
  "content-tags",
  "content-roles",
  "content-documents",
  "content-infochannel",
  "content-locations",
  "content-taggroups",
  "web-character",
  "bot-turns",
  "bot-replies",
  "bot-commands",
  "web-creation",
  "web-map-faction",
  "bot-misc",
  "web-errors",
  "web-gm",
];

function groupForJs(file, entry) {
  for (const rule of JS_GROUPS) {
    if (rule.test(file, entry)) return rule.group;
  }
  return "bot-misc";
}

module.exports = {
  YAML_SOURCES,
  JS_ROOTS,
  IGNORE_DIRS,
  IGNORE_FILES,
  COPY_PROPS,
  COPY_CALLS,
  COPY_CONSTANTS,
  COPY_OBJECT_KEYS,
  REPLY_CALLS,
  REPLY_KEYS,
  EMBED_CALLS,
  EMBED_KEYS,
  LOOSE_ROOTS,
  LOOSE_MIN_WORDS,
  DUAL_SURFACE_FILES,
  GUILLEMET_AUTO_KINDS,
  GROUP_TITLES,
  GROUP_ORDER,
  groupForJs,
};
