import { Prisma } from "@lifeweb/db";

// Excludes bot/UI plumbing that happens to go out as a DM but isn't part of
// a GM<->player conversation: embeds (meta.embed === true), anything tagged
// source: "system_notice" (edit-flow prompts, mention relays, proxy
// hand-back, reaction refusals — see bot/src/lib/dm.js call sites), and
// source: "prompt_reply" (what a player typed back INTO one of those
// prompts, e.g. the ✏️ edit collector — a reply to plumbing is plumbing,
// and counting it made every edit look like an unread message). Applied
// at the query, not the render, so a future noisy sendDm() call needs to
// pass its own `source` to show up here at all.
//
// Written as explicit null-tolerant ORs rather than a NOT over the two
// conditions. In SQL, `NOT (meta->'embed' = true)` is NULL — not true — for
// every row whose meta is NULL or lacks the key, and a NULL predicate drops
// the row. Almost every message is such a row, so the NOT form returned an
// empty thread for every conversation (and a 404 for a player with no
// character, since the page treats "no messages and no character" as an
// unknown id). Same trap on `source`, which is NULL on older rows and on
// anything web/lib/discordGuild.js#sendDm sends without an explicit source.
const NOT_NOISE = [
  // prompt_reply (a ✏️-edit reply) is deliberately NOT excluded here: the rail
  // queries in gm/players/layout.js drop it from the count and preview, but
  // the pane still shows it — hiding a player's DM entirely is worse than
  // one stray line, in case the reply was not a reply at all.
  { OR: [{ source: null }, { source: { not: "system_notice" } }] },
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
