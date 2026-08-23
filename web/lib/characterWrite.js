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
} from "@/lib/characterName";
import { addToStack, dropCharacterTag } from "@/lib/requestEffects";
import { expiryFor } from "@/lib/turnFormat";
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
  "age",
  "preferredNickname",
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
  "worstFear",
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
  if ("preferredNickname" in picked) {
    data.preferredNickname = trimmedOrNull(picked.preferredNickname, 32);
  }
  if ("appearance" in picked) data.appearance = trimmedOrNull(picked.appearance);
  if ("worstFear" in picked) data.worstFear = trimmedOrNull(picked.worstFear);

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
// Ops are keyed by tagId, never characterTagId. A characterTagId can vanish
// between page load and Apply — the expiry sweep in resolveNeeds() deletes
// rows at every turn close — while @@unique([characterId, tagId]) makes tagId
// a stable address, and it is what every requestEffects.js helper takes.

export function validateTagOps(ops, tagsById, held) {
  for (const op of ops ?? []) {
    const tag = tagsById.get(op.tagId);
    if (!tag) throw new UserError("One of those tags no longer exists.");
    if (op.op === "add" || op.op === "patch") {
      const qty = op.quantity ?? 1;
      if (!Number.isInteger(qty) || qty < 1) {
        throw new UserError(`Quantity for ${tag.name} must be a whole number of at least 1.`);
      }
      // addToStack silently pins a non-stackable to 1; say so instead of
      // letting the GM think they granted three.
      if (qty > 1 && !tag.stackable) {
        throw new UserError(`${tag.name} doesn't stack — grant it once.`);
      }
      if (op.equipped && !tag.equippable) {
        throw new UserError(`${tag.name} isn't something that can be equipped.`);
      }
    }
    if (op.op === "patch" && !held.has(op.tagId)) {
      throw new UserError(`${tag.name} isn't on this sheet to adjust.`);
    }
  }
}

function expiresTurnFor(op, tag, openTurn) {
  const mode = op.expiry?.mode ?? "default";
  if (mode === "never") return null;
  // The column is an absolute turn number, never a countdown.
  if (mode === "at") return op.expiry.turn ?? null;
  // "default": expiryFor returns null for an untimed tag, and the correct
  // absolute turn for a timed one. Skipping it is how a GM-granted Paralyzed
  // becomes permanent — resolveNeeds()'s sweep matches on expiresTurn, so a
  // null there never expires at all.
  return expiryFor(tag, openTurn);
}

// Applies staged tag changes inside a transaction. Order is load-bearing:
// removes first, so swapping one tier of a chain for another can't trip the
// equip cap halfway through.
export async function applyTagOpsInTx(tx, { characterId, ops, tagsById, openTurn, equipSlots }) {
  const applied = [];
  const removes = ops.filter((o) => o.op === "remove");
  const adds = ops.filter((o) => o.op === "add");
  const patches = ops.filter((o) => o.op === "patch");

  for (const op of removes) {
    const tag = tagsById.get(op.tagId);
    await dropCharacterTag(tx, characterId, op.tagId, op.quantity ?? null);
    applied.push({ op: "remove", tagId: op.tagId, name: tag.name, quantity: op.quantity ?? null });
  }

  for (const op of adds) {
    const tag = tagsById.get(op.tagId);
    await addToStack(tx, characterId, op.tagId, op.quantity ?? 1, {
      source: op.source ?? "GM_GRANT",
      stackable: tag.stackable,
      expiresTurn: expiresTurnFor(op, tag, openTurn),
    });
    applied.push({ op: "add", tagId: op.tagId, name: tag.name, quantity: op.quantity ?? 1 });
  }

  for (const op of patches) {
    const tag = tagsById.get(op.tagId);
    const row = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: op.tagId } },
    });
    if (!row) continue;
    const data = {};
    if (op.quantity != null) data.quantity = tag.stackable ? op.quantity : 1;
    if (op.source) data.source = op.source;
    if (op.expiry) data.expiresTurn = expiresTurnFor(op, tag, openTurn);
    if (Object.keys(data).length) {
      await tx.characterTag.update({ where: { id: row.id }, data });
    }
    // equipped is written by the batch pass below, not here, but it still
    // belongs in the audit record of what this patch did.
    applied.push({
      op: "patch",
      tagId: op.tagId,
      name: tag.name,
      ...data,
      ...(op.equipped != null ? { equipped: Boolean(op.equipped) } : {}),
    });
  }

  // Equipped last, and counted ONCE for the whole batch rather than per op:
  // a GM staging "unequip A, equip B" must not be rejected on B just because
  // A hasn't been written yet.
  const equipOps = ops.filter((o) => o.equipped != null && o.op !== "remove");
  if (equipOps.length) {
    for (const op of equipOps) {
      await tx.characterTag.updateMany({
        where: { characterId, tagId: op.tagId },
        data: { equipped: Boolean(op.equipped) },
      });
    }
    const equipped = await tx.characterTag.count({ where: { characterId, equipped: true } });
    if (equipped > equipSlots) {
      throw new UserError(`That would fill ${equipped} of ${equipSlots} equipment slots.`);
    }
  }

  return applied;
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
  if (nameChanged || diff.preferredNickname) steps.push("nickname");
  if (diff.lastName && role) steps.push("dynasty");
  if (diff.locationId) steps.push("location");
  if (diff.locationId || tagsTouched) steps.push("narrowcast");

  return steps;
}

// {key: {from, to}} -> {key: to}, for feeding a diff back through a formatter.
function unwrap(diff) {
  return Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to]));
}
