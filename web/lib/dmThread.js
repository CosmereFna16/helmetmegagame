import { Prisma } from "@lifeweb/db";
import { AUTOMATED_EFFECT_SOURCES } from "./dmSources";

// Excludes bot/UI plumbing that happens to go out as a DM but isn't part of
// a GM<->player conversation: embeds (meta.embed === true), anything tagged
// source: "system_notice" (edit-flow prompts, mention relays, proxy
// hand-back, reaction refusals — see bot/src/lib/dm.js call sites), and
// source: "prompt_reply" (what a player typed back INTO one of those
// prompts). Applied at the query, not the render, so a future noisy sendDm()
// call needs to pass its own `source` to show up here at all.
//
// Written as explicit null-tolerant ORs rather than a NOT over the two
// conditions: in SQL, `NOT (meta->'embed' = true)` is NULL — not true — for
// every row whose meta is NULL or lacks the key, and a NULL predicate drops
// the row, which almost every message is. Same trap applies to `source`,
// which is NULL on older rows and on anything sendDm sends without an
// explicit source.
const NOT_NOISE = [
  { OR: [{ source: null }, { source: { not: "system_notice" } }] },
  // Nothing writes prompt_reply any more (the edit flow is a button + modal,
  // bot/src/lib/editModal.js), but rows already in the table stay hidden so a
  // GM never reads a stray in-character poster as mail.
  { OR: [{ source: null }, { source: { not: "prompt_reply" } }] },
  {
    OR: [
      { meta: { equals: Prisma.DbNull } },
      { meta: { path: ["embed"], equals: Prisma.DbNull } },
      { meta: { path: ["embed"], not: true } },
    ],
  },
];

export function withoutDmNoise(where) {
  return { ...where, AND: [...(where?.AND ?? []), ...NOT_NOISE] };
}

// The raw-SQL twin of withoutDmNoise, for the $queryRaw call sites that can't
// take a Prisma `where`. Keep the two predicates in this one file — a
// hand-rolled copy elsewhere drifts and disagrees with the desk.
//
// `alias` is a code-supplied literal (the table alias in the caller's FROM),
// never user input, so Prisma.raw is safe here.
export function dmNoiseSql(alias) {
  const col = (c) => Prisma.raw(alias ? `${alias}."${c}"` : `"${c}"`);
  return Prisma.sql`(${col("source")} IS DISTINCT FROM 'system_notice')
    AND (${col("source")} IS DISTINCT FROM 'prompt_reply')
    AND ((${col("meta")}->>'embed') IS DISTINCT FROM 'true')`;
}

// dmNoiseSql, plus excluding bot/effect noise that reads like conversation
// but isn't one — a resource grant, a dev-panel microaction summary, a
// Move-unlock notice (see dmSources.js for the exact list and why
// staged_push is not in it). For the rail's "last genuine message" preview
// text only — unread counts, the nav badge, and the "awaiting" filter keep
// using dmNoiseSql/withoutDmNoise so recency still reflects any DM.
export function genuineConversationSql(alias) {
  const col = (c) => Prisma.raw(alias ? `${alias}."${c}"` : `"${c}"`);
  const exclusions = AUTOMATED_EFFECT_SOURCES.map((s) => Prisma.sql`(${col("source")} IS DISTINCT FROM ${s})`);
  return Prisma.sql`${dmNoiseSql(alias)} AND ${Prisma.join(exclusions, " AND ")}`;
}

// The rail's preview prefix — "You: " for a message this GM sent, "GM: " for
// another GM's, "Bot: " for a bot-authored line, nothing for the player's own
// words. Lives here, next to the noise predicates, because the desk layout
// and the live-inbox delta (web/lib/inboxDelta.js) both build the same
// preview and must not drift.
export function dmPreviewLabel(genuine, myDiscordUserId) {
  if (!genuine) return "";
  if (genuine.direction === "INBOUND") return "";
  if (!genuine.authorDiscordUserId) return "Bot: ";
  return genuine.authorDiscordUserId === myDiscordUserId ? "You: " : "GM: ";
}
