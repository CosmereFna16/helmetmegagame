import { prisma } from "@lifeweb/db";
import { DATE_PRESETS, auditFamily, familyPrefixes, knownTypesInFamily } from "@/lib/auditNarrative";
import { parseQuery } from "@/lib/fuzzySearch";

// The audit log's filter parser and WHERE builder, shared by the page and the
// export action so a CSV can never disagree with the screen it was taken from.
//
// Filtering is SERVER-side here, unlike every other list in the app
// (DataTable.js). The audit table is unbounded and append-only — it is already
// the app's biggest — so it can never be shipped whole to a browser and sorted
// there. That is also why the whole filter state lives in the URL: a view a GM
// wants to paste at another GM has to survive being a link.

export const PAGE_SIZE = 60;

// Repeatable params arrive from URLSearchParams as either a string or an array
// depending on how many were set; normalize once at the door.
function list(raw) {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return [...new Set(values.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean))];
}

function one(raw) {
  return raw == null ? "" : String(Array.isArray(raw) ? raw[0] : raw).trim();
}

// A `YYYY-MM-DD` query param as a real Date, or null. Null is the right answer
// for anything unparseable: an unfiltered page is a reasonable response to a
// nonsense date, and a thrown Prisma error is not. new Date("banana") is an
// Invalid Date that Prisma rejects, which used to throw inside the page render
// and — with no error boundary in the app — take the whole route to a raw
// digest screen.
export function parseDateParam(raw, timeSuffix) {
  const text = one(raw);
  if (!text) return null;
  const parsed = new Date(`${text}${timeSuffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Reads the raw searchParams object into the one shape everything downstream
// uses. Pure — no queries — so the page can echo it straight back into the
// filter controls and into pageHref().
export function parseAuditParams(params) {
  return {
    q: one(params?.q),
    families: list(params?.family),
    types: list(params?.type),
    actors: list(params?.actor),
    actorKind: one(params?.actorKind),
    targets: list(params?.target),
    factions: list(params?.faction),
    zones: list(params?.zone),
    turnFrom: one(params?.turnFrom),
    turnTo: one(params?.turnTo),
    preset: DATE_PRESETS[one(params?.preset)] ? one(params.preset) : "",
    from: parseDateParam(params?.from, "T00:00:00"),
    to: parseDateParam(params?.to, "T23:59:59"),
    page: Math.max(1, Number.parseInt(one(params?.page) || "1", 10) || 1),
  };
}

// Everything the WHERE needs that is not in the URL: which Discord IDs are
// GMs, which characters belong to which faction and zone (now also their
// role title, for role:-scoped search), where the turn boundaries fall, and
// the guild's Discord handles (for @handle / user:-scoped search — a
// username lives in Discord, not in any table). One call, so the page and
// the export share the cost shape.
export async function loadAuditContext({ gmIds, guildMembers }) {
  const [characters, turns] = await Promise.all([
    prisma.character.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        roleTitle: true,
        faction: { select: { id: true, name: true, zoneId: true, zone: { select: { id: true, name: true } } } },
      },
    }),
    // Ascending, because bucketing a timestamp into a turn is a walk forward
    // through the boundaries.
    prisma.turn.findMany({ select: { number: true, phase: true, startedAt: true }, orderBy: { startedAt: "asc" } }),
  ]);
  return { characters, turns, gmIds: new Set(gmIds ?? []), guildMembers: guildMembers ?? [] };
}

// Which turn a timestamp fell in — the last turn that had started by then.
// AuditLog carries no turnId, and stamping one would only cover rows written
// from today onward, so this derives it for the whole history instead.
export function turnAt(turns, when) {
  let found = null;
  for (const turn of turns) {
    if (turn.startedAt <= when) found = turn;
    else break;
  }
  return found;
}

function turnWindow(turns, fromNumber, toNumber) {
  const from = fromNumber ? turns.find((t) => t.number === Number(fromNumber)) : null;
  // The window ENDS where the turn after `to` began — a turn's rows run until
  // the next one opens, and the last turn's run until now.
  const after = toNumber ? turns.find((t) => t.number === Number(toNumber) + 1) : null;
  return { gte: from?.startedAt ?? null, lt: after?.startedAt ?? null };
}

function presetWindow(preset, turns) {
  const now = new Date();
  switch (preset) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { gte: start, lt: null };
    }
    case "24h":
      return { gte: new Date(now.getTime() - 24 * 3600_000), lt: null };
    case "7d":
      return { gte: new Date(now.getTime() - 7 * 24 * 3600_000), lt: null };
    case "turn": {
      const current = turns.at(-1);
      return { gte: current?.startedAt ?? null, lt: null };
    }
    default:
      return { gte: null, lt: null };
  }
}

// A family clause matches its KNOWN types plus anything carrying one of its
// prefixes — so an action type added at a call site next month still lands in
// the right family without a change to auditNarrative.js.
function familyClause(family) {
  const known = knownTypesInFamily(family);
  const prefixes = familyPrefixes(family);
  const branches = [
    ...(known.length ? [{ actionType: { in: known } }] : []),
    ...prefixes.map((p) => ({ actionType: { startsWith: p } })),
  ];
  // A family with neither (only Lifeweb, whose members are all overrides)
  // still has its known list, so this is defensive rather than reachable.
  return branches.length ? { OR: branches } : { actionType: { in: [] } };
}

// Ids whose `details` blob mentions the search text. Prisma cannot express a
// cast-to-text LIKE over a Json column, and the alternative — pulling every
// row into node to scan — is not a search, it is a table dump. The LIMIT is
// the honest cost of an unindexable full-table ILIKE: a `q` that appears in
// more than this many details blobs alone will match only the newest of them,
// which beats either a timeout or dropping the branch entirely.
const DETAILS_SEARCH_LIMIT = 5000;

async function detailsMatchIds(q) {
  const rows = await prisma.$queryRaw`
    SELECT "id" FROM "AuditLog"
    WHERE "details"::text ILIKE ${`%${q}%`}
    ORDER BY "createdAt" DESC
    LIMIT ${DETAILS_SEARCH_LIMIT}
  `;
  return rows.map((r) => r.id);
}

// Discord handles a term matches — a username lives in Discord, not in any
// table, so this is the whole reason ctx carries guildMembers.
function matchGuildMemberIds(guildMembers, term) {
  const lower = term.toLowerCase();
  return guildMembers
    .filter((m) => m.username?.toLowerCase().includes(lower) || m.globalName?.toLowerCase().includes(lower))
    .map((m) => m.id);
}

// Characters whose `getter` field contains `term` — split into the actor
// branch (their Discord id) and the target branch (their character id),
// since either can carry a role:/faction:/zone: hit.
function matchCharacterIds(characters, term, getter) {
  const lower = term.toLowerCase();
  const matched = characters.filter((c) => (getter(c) ?? "").toLowerCase().includes(lower));
  return { actorIds: matched.map((c) => c.discordUserId), targetIds: matched.map((c) => c.id) };
}

const SCOPED_FIELD_GETTERS = {
  role: (c) => c.roleTitle,
  faction: (c) => c.faction?.name,
  zone: (c) => c.faction?.zone?.name,
};

// One word of a parsed query (see web/lib/fuzzySearch.js#parseQuery) into a
// Prisma OR clause. A scoped word (role:/faction:/zone:/username:) narrows to
// that one branch; a bare word, or an explicit text:/notes: scope, gets the
// full-breadth search every unscoped query has always run. An empty result
// set on a scoped word (e.g. role:xyz matching nobody) correctly resolves to
// "no rows", not "ignore the scope" — { in: [] } is a real Prisma empty set.
async function wordWhere(word, ctx) {
  const term = word.term;
  if (!term) return null;

  if (word.field === "username") {
    return { actorDiscordUserId: { in: matchGuildMemberIds(ctx.guildMembers, term) } };
  }
  if (SCOPED_FIELD_GETTERS[word.field]) {
    const { actorIds, targetIds } = matchCharacterIds(ctx.characters, term, SCOPED_FIELD_GETTERS[word.field]);
    return { OR: [{ actorDiscordUserId: { in: actorIds } }, { targetCharacterId: { in: targetIds } }] };
  }

  const lower = term.toLowerCase();
  const matchedActorIds = ctx.characters.filter((c) => c.name.toLowerCase().includes(lower)).map((c) => c.discordUserId);
  const usernameIds = matchGuildMemberIds(ctx.guildMembers, term);
  const detailIds = await detailsMatchIds(term);
  return {
    OR: [
      { actionType: { contains: term, mode: "insensitive" } },
      { actorDiscordUserId: { contains: term, mode: "insensitive" } },
      { reason: { contains: term, mode: "insensitive" } },
      { targetCharacter: { name: { contains: term, mode: "insensitive" } } },
      ...(matchedActorIds.length ? [{ actorDiscordUserId: { in: matchedActorIds } }] : []),
      ...(usernameIds.length ? [{ actorDiscordUserId: { in: usernameIds } }] : []),
      ...(detailIds.length ? [{ id: { in: detailIds } }] : []),
    ],
  };
}

// Builds the Prisma WHERE. Async only because of the details-text branch
// above; everything else is derived from the context the caller already
// loaded.
export async function buildAuditWhere(filters, ctx) {
  const and = [];

  if (filters.families.length) {
    and.push({ OR: filters.families.map(familyClause) });
  }
  if (filters.types.length) {
    and.push({ actionType: { in: filters.types } });
  }
  if (filters.actors.length) {
    and.push({ actorDiscordUserId: { in: filters.actors } });
  }

  // "system" is a literal actorDiscordUserId the turn engine writes, not a
  // real Discord ID — so Player is "neither a GM nor the engine".
  if (filters.actorKind === "gm") {
    and.push({ actorDiscordUserId: { in: [...ctx.gmIds] } });
  } else if (filters.actorKind === "system") {
    and.push({ actorDiscordUserId: "system" });
  } else if (filters.actorKind === "player") {
    and.push({ actorDiscordUserId: { notIn: [...ctx.gmIds, "system"] } });
  }

  if (filters.targets.length) {
    and.push({ targetCharacterId: { in: filters.targets } });
  }

  // Faction and zone are properties of the TARGET character, and zone means
  // their faction's zone rather than where they are standing — the rule
  // ZoneChip states. Resolved to character ids here because AuditLog carries
  // neither column.
  if (filters.factions.length) {
    const set = new Set(filters.factions);
    and.push({
      targetCharacterId: { in: ctx.characters.filter((c) => set.has(c.faction?.id)).map((c) => c.id) },
    });
  }
  if (filters.zones.length) {
    const set = new Set(filters.zones);
    and.push({
      targetCharacterId: { in: ctx.characters.filter((c) => set.has(c.faction?.zone?.id)).map((c) => c.id) },
    });
  }

  // Date: an explicit from/to wins over a preset, and a turn range narrows
  // whatever is left. They compose rather than override, so "this turn" plus a
  // From date is an intersection and not a surprise.
  const windows = [];
  if (filters.preset) windows.push(presetWindow(filters.preset, ctx.turns));
  if (filters.turnFrom || filters.turnTo) windows.push(turnWindow(ctx.turns, filters.turnFrom, filters.turnTo));
  if (filters.from) windows.push({ gte: filters.from, lt: null });
  if (filters.to) windows.push({ gte: null, lt: filters.to });
  for (const w of windows) {
    if (w.gte) and.push({ createdAt: { gte: w.gte } });
    if (w.lt) and.push({ createdAt: { lt: w.lt } });
  }

  if (filters.q) {
    // Split on whitespace into bare terms (match anything) and field:term /
    // @term scopes (match one branch only) — see parseQuery. Each word is
    // its own AND entry, so "role:smith caves" is a real two-term AND, not
    // one long substring the way a single `contains: q` was.
    const { bare, scoped } = parseQuery(filters.q);
    const words = [...bare.map((term) => ({ term, field: null })), ...scoped];
    for (const word of words) {
      and.push(await wordWhere(word, ctx));
    }
  }

  return and.length ? { AND: and } : {};
}

// Every filter back into a query string, dropping the empties so a default
// view is a bare /gm/audit rather than a wall of `&type=&actor=`.
export function auditHref(filters, overrides = {}) {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  const put = (key, value) => {
    if (value) params.append(key, value);
  };
  put("q", f.q);
  for (const v of f.families) put("family", v);
  for (const v of f.types) put("type", v);
  for (const v of f.actors) put("actor", v);
  put("actorKind", f.actorKind);
  for (const v of f.targets) put("target", v);
  for (const v of f.factions) put("faction", v);
  for (const v of f.zones) put("zone", v);
  put("turnFrom", f.turnFrom);
  put("turnTo", f.turnTo);
  put("preset", f.preset);
  // The normalized strings, not the Date objects — a Date in a
  // URLSearchParams stringifies to a full RFC date the next parse rejects.
  put("from", f.from ? f.from.toISOString().slice(0, 10) : "");
  put("to", f.to ? f.to.toISOString().slice(0, 10) : "");
  if (f.page > 1) put("page", String(f.page));
  const qs = params.toString();
  return qs ? `/gm/audit?${qs}` : "/gm/audit";
}

export { auditFamily, DATE_PRESETS };
