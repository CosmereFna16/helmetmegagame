// The pure core of "a GM changed something about this character".
//
// Lives here rather than in the Dev Panel's actions.js because a "use server"
// module may only export async functions — the validators, the differ and the
// effect planner below are none of those, and a "use server" file exporting
// them fails the build.
//
// Nothing in this file talks to Discord. It decides WHAT should happen; the
// caller runs the REST half afterwards, outside the transaction, because a
// Discord call inside a $transaction holds a Postgres connection open across
// the network for as long as Discord takes to answer (ARCHITECTURE.md §5).
import { isDynastyMember } from "@lifeweb/db";
import {
  NAME_LIMITS,
  AGE_MIN,
  AGE_MAX,
  formatCharacterName,
  formatBareName,
  normalizeHonorific,
  GENDERS,
} from "@/lib/characterName";
import {
  TagOpError,
  validateTagOps as validateTagOpsDb,
  applyTagOpsInTx as applyTagOpsInTxDb,
} from "@lifeweb/db/lib/tagOps";
import { UserError } from "@/lib/actionResult";
import { dynastyLastName } from "@/lib/dynasty";

// Every field the panel may stage. Anything not on this list is ignored
// outright rather than passed through — a server action is a public endpoint,
// and an allowlist is the only way a posted `{ discordUserId: "..." }` can't
// reassign a character to a different account.
export const EDITABLE_FIELDS = [
  "honorific",
  "firstName",
  "title",
  "lastName",
  "gender",
  "age",
  "appearance",
  "roleId",
  "roleTitle",
  "factionId",
  "zoneId",
  "locationId",
  "isLeader",
  "isTreasurer",
  "resources",
  "tagPoints",
  "turnPingOptIn",
  "romanceOptOut",
  "fear",
];

// `status` is deliberately NOT editable here. Kill and Revive are their own
// microactions with their own Discord side effects, so Apply never has to
// reason about a status transition and can read the live value instead.

function trimmedOrNull(value, limit) {
  if (value == null) return null;
  const text = value.toString().trim();
  if (!text) return null;
  return limit ? text.slice(0, limit) : text;
}

function intOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function bool(value) {
  return value === true || value === "true" || value === "on";
}

// Turns the raw posted `core` object into exactly the columns to write.
//
// Async because two of the rules need a lookup: the role being SAVED decides
// whether the last name is dynasty-locked, and the dynasty name itself is
// read off the living Baron. Both are plain reads, so they happen here rather
// than inside the transaction.
export async function normalizeCoreEdits({ prisma, existing, core }) {
  const picked = {};
  for (const key of EDITABLE_FIELDS) {
    if (Object.hasOwn(core ?? {}, key)) picked[key] = core[key];
  }

  const data = {};

  // ── names ───────────────────────────────────────────────────────────────
  // Length-capped and allowlisted exactly like the player forms. The caps are
  // what keep the composed name inside Discord's 80-character webhook
  // username limit, so they are not cosmetic.
  if ("honorific" in picked) data.honorific = normalizeHonorific(picked.honorific);
  if ("firstName" in picked) {
    const first = trimmedOrNull(picked.firstName, NAME_LIMITS.firstName);
    if (!first) throw new UserError("A character needs a first name.");
    data.firstName = first;
  }
  if ("title" in picked) data.title = trimmedOrNull(picked.title, NAME_LIMITS.title);
  if ("lastName" in picked) data.lastName = trimmedOrNull(picked.lastName, NAME_LIMITS.lastName);

  // A GM may correct a gender freely — the chosen-once rule is a player-side
  // rule, not a database one, same exemption `age` gets below. A value off the
  // enum is refused rather than silently defaulted, because unlike a player
  // form there is no picker upstream that could only have sent a valid one.
  if ("gender" in picked) {
    const value = (picked.gender ?? "").toString().trim();
    if (!GENDERS.includes(value)) throw new UserError("That isn't a gender.");
    data.gender = value;
  }

  // ── role, and the dynasty lock that rides on it ─────────────────────────
  const roleId = "roleId" in picked ? trimmedOrNull(picked.roleId) : existing.roleId;
  const role = roleId ? await prisma.role.findUnique({ where: { id: roleId } }) : null;
  if (roleId && !role) throw new UserError("That role no longer exists.");
  if ("roleId" in picked) data.roleId = roleId;

  // Picking a Role restamps the display title from the catalog; roleTitle
  // stays hand-editable for off-catalog cases only.
  if ("roleId" in picked || "roleTitle" in picked) {
    data.roleTitle = role
      ? role.name
      : trimmedOrNull("roleTitle" in picked ? picked.roleTitle : existing.roleTitle);
  }

  // Keyed on the role being SAVED, so moving someone into a family seat
  // renames them in the same write. A GM changes the dynasty by editing the
  // Baron — which propagates — never by typing a surname onto the Baroness.
  if (isDynastyMember(role?.slug)) data.lastName = await dynastyLastName();

  // ── the denormalised composed name ──────────────────────────────────────
  // Character.name has a fixed set of writers, all of which must go through
  // the formatter (schema.prisma). This is the GM one.
  const merged = {
    honorific: "honorific" in data ? data.honorific : existing.honorific,
    firstName: "firstName" in data ? data.firstName : existing.firstName,
    title: "title" in data ? data.title : existing.title,
    lastName: "lastName" in data ? data.lastName : existing.lastName,
  };
  data.name = formatCharacterName(merged);

  // ── everything else ─────────────────────────────────────────────────────
  if ("age" in picked) {
    const age = intOrNull(picked.age);
    if (age != null && (age < AGE_MIN || age > AGE_MAX)) {
      throw new UserError(`Age must be between ${AGE_MIN} and ${AGE_MAX}.`);
    }
    // A GM may set or correct an age freely — the once-only lock is a
    // player-side rule, not a database one.
    data.age = age;
  }
  if ("appearance" in picked) data.appearance = trimmedOrNull(picked.appearance);
  if ("fear" in picked) data.fear = trimmedOrNull(picked.fear);

  if ("factionId" in picked) {
    const factionId = trimmedOrNull(picked.factionId);
    if (factionId) {
      const faction = await prisma.faction.findUnique({ where: { id: factionId } });
      if (!faction) throw new UserError("That faction no longer exists.");
    }
    data.factionId = factionId;
  }

  // zoneId mirrors location.zoneId whenever a Location is set (see the
  // Location model comment in schema.prisma); a raw zone is only meaningful
  // for a character standing nowhere in particular.
  if ("locationId" in picked || "zoneId" in picked) {
    const locationId = "locationId" in picked ? trimmedOrNull(picked.locationId) : existing.locationId;
    let zoneId = "zoneId" in picked ? trimmedOrNull(picked.zoneId) : existing.zoneId;
    if (locationId) {
      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location) throw new UserError("That location no longer exists.");
      zoneId = location.zoneId ?? zoneId;
    }
    if ("locationId" in picked) data.locationId = locationId;
    data.zoneId = zoneId;
  }

  if ("resources" in picked) data.resources = intOrNull(picked.resources) ?? 0;
  // tagPoints is allowed to go negative on purpose — clamping it at 0 would
  // let a broke player take a drawback's points for free (CHARACTERS.md).
  if ("tagPoints" in picked) data.tagPoints = intOrNull(picked.tagPoints) ?? 0;
  if ("isTreasurer" in picked) data.isTreasurer = bool(picked.isTreasurer);
  if ("turnPingOptIn" in picked) data.turnPingOptIn = bool(picked.turnPingOptIn);
  if ("romanceOptOut" in picked) data.romanceOptOut = bool(picked.romanceOptOut);

  // isLeader is handled separately by setLeaderInTx — writing the boolean
  // bare is how a faction ends up with two leaders.
  const leader = "isLeader" in picked ? bool(picked.isLeader) : null;

  return { data, role, leader };
}

// Key-by-key {from, to} over only the keys actually being written. Drives
// both the audit row and the Discord effect plan, so nothing downstream
// re-derives "did the location change?" from raw input.
export function diffCore(existing, data) {
  const diff = {};
  for (const [key, to] of Object.entries(data)) {
    const from = existing[key] ?? null;
    const next = to ?? null;
    if (from instanceof Date ? from.getTime() !== next?.getTime?.() : from !== next) {
      diff[key] = { from, to: next };
    }
  }
  return diff;
}

// The clear-then-set pair out of faction/actions.js#setFactionLeader, so the
// faction page and the Dev Panel share one definition of "there is exactly
// one leader". Keyed on the POST-EDIT faction: promoting someone who is also
// changing faction must demote the new faction's leader, not the old one.
export async function setLeaderInTx(tx, { characterId, factionId, isLeader }) {
  if (!isLeader) {
    await tx.character.update({ where: { id: characterId }, data: { isLeader: false } });
    return;
  }
  if (!factionId) throw new UserError("Only a member of a faction can lead it.");
  await tx.character.updateMany({
    where: { factionId, isLeader: true, id: { not: characterId } },
    data: { isLeader: false },
  });
  await tx.character.update({ where: { id: characterId }, data: { isLeader: true } });
}

// ── tag ops ────────────────────────────────────────────────────────────────
//
// The engine itself lives in @lifeweb/db/lib/tagOps now — the staged-push
// pass applies the same ops at turn end, and db/ cannot import web/. These
// wrappers exist to translate its plain TagOpError into the UserError that
// guarded() renders; the validation rules and apply order are unchanged and
// documented there.

function rethrowForUser(err) {
  if (err instanceof TagOpError) throw new UserError(err.message);
  throw err;
}

export function validateTagOps(ops, tagsById, held) {
  try {
    validateTagOpsDb(ops, tagsById, held);
  } catch (err) {
    rethrowForUser(err);
  }
}

export async function applyTagOpsInTx(tx, args) {
  try {
    return await applyTagOpsInTxDb(tx, args);
  } catch (err) {
    rethrowForUser(err);
  }
}

// ── the Discord plan ───────────────────────────────────────────────────────
//
// One plan object, built from the diff, executed in order after the
// transaction commits. Written as a plan rather than a run of independent
// `if` blocks specifically so that a dead character can't fall through into a
// branch that re-grants channel access — re-syncing a corpse is the bug the
// old editor's comment warns about.
export function planDiscordEffects({ existing, diff, finalStatus, role, tagsTouched }) {
  if (finalStatus !== "ALIVE") return [];

  const steps = [];
  const nameChanged = Boolean(diff.name);
  const bareChanged =
    formatBareName(existing) !== formatBareName({ ...existing, ...unwrap(diff) });

  if (nameChanged || bareChanged || !existing.discordRoleId) steps.push("role");
  if (nameChanged) steps.push("nickname");
  if (diff.lastName && role) steps.push("dynasty");
  if (diff.locationId) steps.push("location");
  if (diff.locationId || tagsTouched) steps.push("narrowcast");

  return steps;
}

// {key: {from, to}} -> {key: to}, for feeding a diff back through a formatter.
function unwrap(diff) {
  return Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to]));
}
