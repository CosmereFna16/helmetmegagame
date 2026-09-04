"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole } from "@/lib/factionPermissions";
import { isUnaffiliated, UNAFFILIATED_SLUG } from "@lifeweb/db/lib/factionConstants";
import { after } from "next/server";
import { guarded, UserError } from "@/lib/actionResult";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { addToStack } from "@lifeweb/db/lib/tagWrites";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

export async function setFactionLeader(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  if (!characterId || !factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || isUnaffiliated(faction)) return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.factionId !== factionId) return;

  await prisma.$transaction([
    prisma.character.updateMany({ where: { factionId, isLeader: true }, data: { isLeader: false } }),
    prisma.character.update({ where: { id: characterId }, data: { isLeader: true } }),
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_leader_set",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

// Grants or revokes Treasurer for a faction member — callable by the
// faction's own Leader (checked via getMyFactionRole, not just GMs) since
// delegating officer authority is meant to be a Leader's call, not a GM
// errand.
export async function setTreasurer(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  const grant = formData.get("grant") === "true";
  if (!characterId || !factionId) return;

  const { isGm: gm } = await getGmSession();
  const { isLeader } = await getMyFactionRole(session.discordUserId, factionId);
  if (!gm && !isLeader) throw new Error("Not authorized.");

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.factionId !== factionId) return;

  await prisma.character.update({ where: { id: characterId }, data: { isTreasurer: grant } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: grant ? "faction_treasurer_assigned" : "faction_treasurer_revoked",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

export async function addCharacterToFaction(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  const factionId = formData.get("factionId")?.toString();
  if (!characterId || !factionId) return;

  // Both ids resolved before the write, same as setFactionLeader above.
  // Updating straight from formData threw Prisma's P2025/FK violation on a
  // stale or hand-posted id, and Next redacts a thrown error to a bare digest
  // — so the GM got a broken page instead of a no-op.
  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction) return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

  await prisma.character.update({
    where: { id: characterId },
    data: { factionId, isLeader: false },
  });

  // Same sweep assignFactionMember does: a handshake this character had open
  // is moot once a GM has placed them, and leaving it pending would put a
  // ghost row in some officer's queue.
  await prisma.factionApplication.updateMany({
    where: { characterId, status: "PENDING" },
    data: { status: "WITHDRAWN" },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_added",
      targetCharacterId: characterId,
      details: { factionId },
    },
  });

  revalidatePath("/faction");
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

export async function removeCharacterFromFaction(formData) {
  const session = await requireGm();
  const characterId = formData.get("characterId")?.toString();
  if (!characterId) return;

  const unaffiliated = await prisma.faction.findFirst({ where: { slug: UNAFFILIATED_SLUG } });
  if (!unaffiliated) return;

  // Resolved before the write for the same reason as addCharacterToFaction.
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

  await prisma.character.update({
    where: { id: characterId },
    // isTreasurer too: the seat belongs to the faction, not the person, and
    // leaving it set followed them out the door.
    data: { factionId: unaffiliated.id, isLeader: false, isTreasurer: false },
  });
  await prisma.factionApplication.updateMany({
    where: { characterId, status: "PENDING" },
    data: { status: "WITHDRAWN" },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_member_removed",
      targetCharacterId: characterId,
    },
  });

  revalidatePath("/faction");
  // The Factions tab of the Players panel shows the same leaders and counts.
  revalidatePath("/gm/players", "layout");
}

// ---------------------------------------------------------------------------
// Player-driven membership (FACTIONS.md).
//
// Everything below answers to a player rather than a GM, so it takes plain
// arguments and returns a { ok } result through guarded() instead of a
// formData no-op — a thrown error would reach the console as React #441
// (web/lib/actionResult.js). The acting character is always resolved from the
// session; a posted id says WHO to act on, never who is acting.
// ---------------------------------------------------------------------------

async function requireActor() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      factionId: true,
      zoneId: true,
      isLeader: true,
      isTreasurer: true,
      discordUserId: true,
      faction: { select: { id: true, slug: true, name: true, siloRoomId: true, parentFactionId: true } },
    },
  });
  if (!character) throw new UserError("You don't have a living character. ‡");
  return { session, character };
}

async function audit(session, actionType, characterId, details) {
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType,
      targetCharacterId: characterId ?? null,
      details: details ?? {},
    },
  });
}

function revalidateFaction() {
  revalidatePath("/faction");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
}

// The officers of a faction, for the DMs that tell somebody an application
// landed. Both seats, because either can answer it.
async function officersOf(factionId) {
  return prisma.character.findMany({
    where: { factionId, status: "ALIVE", OR: [{ isLeader: true }, { isTreasurer: true }] },
    select: { id: true, name: true, discordUserId: true },
  });
}

async function unaffiliatedFaction() {
  const row = await prisma.faction.findFirst({ where: { slug: UNAFFILIATED_SLUG }, select: { id: true } });
  if (!row) throw new UserError("The game has no Unaffiliated faction to leave to. ‡");
  return row;
}

// Moving a character out of a faction, whether they walked or were shown the
// door. Three things always travel together, which is why this is one helper:
// the officer seats come off (they belong to the seat, not the person), every
// handshake they had open with that faction is closed, and if they were the
// Leader somebody else has to be.
async function detachMember(tx, character, toFactionId) {
  await tx.character.update({
    where: { id: character.id },
    data: { factionId: toFactionId, isLeader: false, isTreasurer: false },
  });
  await tx.factionApplication.updateMany({
    where: { characterId: character.id, status: "PENDING" },
    data: { status: "WITHDRAWN" },
  });
  if (character.isLeader && character.factionId) await promoteSuccessor(tx, character.factionId);
}

// A faction whose Leader just walked out is not left ownerless: the
// longest-standing living member takes the seat. A Treasurer is preferred,
// because they already held office; a Catatonic member is taken LAST, since
// crowning somebody who has left the Discord server leaves the faction just
// as stuck as leaving the seat empty. If nobody is left the faction simply
// has no Leader — it still exists, and a GM or a new member can fill it.
async function promoteSuccessor(tx, factionId) {
  const remaining = await tx.character.findMany({
    where: { factionId, status: "ALIVE", isLeader: false },
    orderBy: [{ isTreasurer: "desc" }, { createdAt: "asc" }],
    select: { id: true, tags: { where: { tag: { slug: CATATONIC_SLUG } }, select: { id: true } } },
  });
  const heir = remaining.find((c) => c.tags.length === 0) ?? remaining[0];
  if (!heir) return null;
  await tx.character.update({ where: { id: heir.id }, data: { isLeader: true } });
  return heir.id;
}

// Slug from a player-typed name, uniquified. The slug is permanent and the
// name is not, so this runs once, at founding, and never again on a rename.
async function freeSlug(name) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "faction";
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const taken = await prisma.faction.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new UserError("Too many factions are called that. Pick another name. ‡");
}

function cleanName(raw) {
  const name = (raw ?? "").toString().trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new UserError("A faction needs a name. ‡");
  if (name.length > 48) throw new UserError("That name is too long. ‡");
  return name;
}

// Only `slug` is unique in the database, so nothing stopped two factions from
// both being called "The Ash Company" — or "Unaffiliated". Code no longer
// branches on the name (§1a), but a roster with two identical entries is a
// people problem whether or not it is a code one.
async function requireFreeName(name, exceptFactionId = null) {
  const clash = await prisma.faction.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptFactionId ? { id: { not: exceptFactionId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new UserError("Something is already called that. ‡");
}

function cleanNote(raw) {
  return (raw ?? "").toString().trim().slice(0, 500);
}

// --- Leaving ---------------------------------------------------------------

async function leaveFactionImpl() {
  const { session, character } = await requireActor();
  if (isUnaffiliated(character.faction)) throw new UserError("You aren't in a faction. ‡");

  const old = character.faction;
  const unaffiliated = await unaffiliatedFaction();
  await prisma.$transaction(async (tx) => {
    await detachMember(tx, character, unaffiliated.id);
  });
  await audit(session, "faction_left", character.id, { factionId: old.id, factionName: old.name });

  for (const officer of await officersOf(old.id)) {
    notifyCharacter(officer, `${character.name} has left ${old.name}. ‡`);
  }
  revalidateFaction();
  return { factionName: old.name };
}

// The officer-side twin of leaving. Same machinery, someone else's decision.
async function removeMemberImpl({ characterId }) {
  const { session, character } = await requireActor();
  if (!character.isLeader && !character.isTreasurer) throw new UserError("Only an officer can do that. ‡");
  if (characterId === character.id) throw new UserError("Use Leave to walk out yourself. ‡");

  const target = await prisma.character.findUnique({
    where: { id: characterId?.toString() ?? "" },
    select: { id: true, name: true, factionId: true, isLeader: true, discordUserId: true },
  });
  if (!target || target.factionId !== character.factionId) throw new UserError("They aren't in your faction. ‡");
  // A Treasurer cannot throw out the Leader they answer to.
  if (target.isLeader && !character.isLeader) throw new UserError("Only the Leader can do that. ‡");

  const factionName = character.faction.name;
  const unaffiliated = await unaffiliatedFaction();
  await prisma.$transaction(async (tx) => {
    await detachMember(tx, target, unaffiliated.id);
  });
  await audit(session, "faction_member_removed", target.id, { factionId: character.factionId });

  notifyCharacter(target, `You are no longer part of ${factionName}. ‡`);
  revalidateFaction();
  return { name: target.name };
}

// --- Applying and inviting -------------------------------------------------

async function applyToFactionImpl({ factionId, note }) {
  const { session, character } = await requireActor();
  const faction = await prisma.faction.findUnique({
    where: { id: factionId?.toString() ?? "" },
    select: { id: true, name: true, slug: true },
  });
  if (!faction) throw new UserError("No such faction. ‡");
  if (isUnaffiliated(faction)) throw new UserError("Unaffiliated isn't a faction to join. ‡");
  if (faction.id === character.factionId) throw new UserError("You're already in it. ‡");

  const existing = await prisma.factionApplication.findFirst({
    where: { factionId: faction.id, characterId: character.id, status: "PENDING" },
    select: { id: true, kind: true },
  });
  // An outstanding invite from the same faction is an answer waiting to be
  // given, not a reason to refuse — say so rather than reporting a duplicate.
  if (existing) {
    throw new UserError(
      existing.kind === "INVITE"
        ? `${faction.name} has already invited you — answer that instead. ‡`
        : "You've already asked them. ‡",
    );
  }

  await prisma.factionApplication.create({
    data: { factionId: faction.id, characterId: character.id, kind: "APPLICATION", note: cleanNote(note) },
  });
  await audit(session, "faction_application_filed", character.id, { factionId: faction.id });

  for (const officer of await officersOf(faction.id)) {
    notifyCharacter(officer, `${character.name} has asked to join ${faction.name}. ‡`);
  }
  revalidateFaction();
  return { factionName: faction.name };
}

async function inviteToFactionImpl({ characterId, note }) {
  const { session, character } = await requireActor();
  if (!character.isLeader && !character.isTreasurer) throw new UserError("Only an officer can invite. ‡");
  if (isUnaffiliated(character.faction)) throw new UserError("Unaffiliated isn't a faction to invite into. ‡");

  const target = await prisma.character.findFirst({
    where: { id: characterId?.toString() ?? "", status: "ALIVE" },
    select: { id: true, name: true, factionId: true, discordUserId: true },
  });
  if (!target) throw new UserError("No such character. ‡");
  if (target.factionId === character.factionId) throw new UserError("They're already with you. ‡");

  const existing = await prisma.factionApplication.findFirst({
    where: { factionId: character.factionId, characterId: target.id, status: "PENDING" },
    select: { id: true, kind: true },
  });
  if (existing) {
    throw new UserError(
      existing.kind === "APPLICATION"
        ? `${target.name} has already applied — answer that instead. ‡`
        : "They've already been invited. ‡",
    );
  }

  await prisma.factionApplication.create({
    data: { factionId: character.factionId, characterId: target.id, kind: "INVITE", note: cleanNote(note) },
  });
  await audit(session, "faction_invite_sent", target.id, { factionId: character.factionId });

  notifyCharacter(target, `${character.faction.name} has invited you to join them. ‡`);
  revalidateFaction();
  return { name: target.name };
}

async function withdrawApplicationImpl({ applicationId }) {
  const { session, character } = await requireActor();
  const row = await prisma.factionApplication.findUnique({
    where: { id: applicationId?.toString() ?? "" },
    select: { id: true, kind: true, status: true, characterId: true, factionId: true },
  });
  if (!row || row.status !== "PENDING") throw new UserError("That's already been answered. ‡");

  // You may pull back what YOU opened: your own application, or an invite
  // your faction sent — and for the invite, only as an officer.
  const mine =
    row.kind === "APPLICATION"
      ? row.characterId === character.id
      : row.factionId === character.factionId && (character.isLeader || character.isTreasurer);
  if (!mine) throw new UserError("That isn't yours to withdraw. ‡");

  await prisma.factionApplication.update({
    where: { id: row.id },
    data: { status: "WITHDRAWN" },
  });
  await audit(session, "faction_application_withdrawn", row.characterId, { factionId: row.factionId });
  revalidateFaction();
  return {};
}

// One decision point for both directions. Who may answer depends on which way
// the handshake was opened: an officer answers an APPLICATION, the named
// character answers an INVITE.
async function decideApplicationImpl({ applicationId, accept, grantTagSlug }) {
  const { session, character } = await requireActor();
  const row = await prisma.factionApplication.findUnique({
    where: { id: applicationId?.toString() ?? "" },
    include: {
      faction: { select: { id: true, name: true, slug: true } },
      character: { select: { id: true, name: true, factionId: true, isLeader: true, discordUserId: true, status: true } },
    },
  });
  if (!row || row.status !== "PENDING") throw new UserError("That's already been answered. ‡");

  const isOfficerHere =
    row.factionId === character.factionId && (character.isLeader || character.isTreasurer);
  const mayAnswer = row.kind === "APPLICATION" ? isOfficerHere : row.characterId === character.id;
  if (!mayAnswer) throw new UserError("That isn't yours to answer. ‡");

  if (!accept) {
    await prisma.factionApplication.update({
      where: { id: row.id },
      data: { status: "DECLINED" },
    });
    await audit(session, "faction_application_declined", row.characterId, { factionId: row.factionId });
    if (row.kind === "APPLICATION") {
      notifyCharacter(row.character, `${row.faction.name} has turned down your application. ‡`);
    } else {
      for (const officer of await officersOf(row.factionId)) {
        notifyCharacter(officer, `${row.character.name} has declined your invitation. ‡`);
      }
    }
    revalidateFaction();
    return { accepted: false, name: row.character.name };
  }

  // A character who died or moved on between the ask and the answer.
  if (row.character.status !== "ALIVE") throw new UserError(`${row.character.name} is beyond joining. ‡`);
  if (row.character.factionId === row.factionId) throw new UserError("They're already with you. ‡");

  // The keys a recruit needs to reach their new faction's silo. The Brigands'
  // camp is behind a tag, so letting somebody in without it hands them a home
  // they can't find (FACTIONS.md §6).
  //
  // Which keys travel depends on WHO is answering, and that is a permission
  // check, not a preference:
  //
  // - An officer answering an APPLICATION chooses, via `grantTagSlug`, and
  //   the choice is bounded to their own silo's keys.
  // - An INVITE is answered by the invitee, so `grantTagSlug` is ignored
  //   outright — honouring it would let anyone holding an invitation post
  //   themselves the Cathedral Key the officer chose not to give. Instead the
  //   silo's keys are granted in full, because an officer who invited
  //   somebody in has already decided they belong there. Without this an
  //   invited Brigand could never receive the camp tag at all: `hills-camp`
  //   is untradeable, so no later hand-over exists.
  const keySlugs = await siloKeySlugs(row.factionId);
  let grantSlugs = [];
  if (row.kind === "INVITE") {
    grantSlugs = keySlugs;
  } else if (grantTagSlug) {
    const wanted = grantTagSlug.toString();
    if (!keySlugs.includes(wanted)) throw new UserError("That tag isn't a key to your silo. ‡");
    grantSlugs = [wanted];
  }
  const grantTags = grantSlugs.length
    ? await prisma.tag.findMany({
        where: { slug: { in: grantSlugs } },
        select: { id: true, slug: true, name: true },
      })
    : [];

  const unaffiliated = await unaffiliatedFaction();
  await prisma.$transaction(async (tx) => {
    if (row.character.factionId && row.character.factionId !== unaffiliated.id) {
      await detachMember(tx, row.character, unaffiliated.id);
    }
    await tx.character.update({
      where: { id: row.characterId },
      data: { factionId: row.factionId, isLeader: false, isTreasurer: false },
    });
    // Every other handshake this character had open is moot now.
    await tx.factionApplication.updateMany({
      where: { characterId: row.characterId, status: "PENDING", id: { not: row.id } },
      data: { status: "WITHDRAWN" },
    });
    await tx.factionApplication.update({
      where: { id: row.id },
      data: { status: "ACCEPTED" },
    });
    for (const tag of grantTags) {
      await addToStack(tx, row.characterId, tag.id, 1, { source: "GM_GRANT" });
    }
  });
  await audit(session, "faction_application_accepted", row.characterId, {
    factionId: row.factionId,
    grantedTags: grantTags.map((t) => t.slug),
  });

  if (grantTags.length) await syncCharacterRoomAccessFor(row.characterId);
  notifyCharacter(row.character, `You are now part of ${row.faction.name}. ‡`);
  for (const officer of await officersOf(row.factionId)) {
    if (officer.id === row.characterId) continue;
    notifyCharacter(officer, `${row.character.name} has joined ${row.faction.name}. ‡`);
  }
  revalidateFaction();
  return { accepted: true, name: row.character.name };
}

// The access tags on a faction's own silo room — the only tags an officer may
// hand out through the Accept button. Anything else would make the join
// handshake a general-purpose tag faucet.
async function siloKeySlugs(factionId) {
  const faction = await prisma.faction.findUnique({
    where: { id: factionId },
    select: { siloRoom: { select: { accessTagSlugs: true } } },
  });
  return faction?.siloRoom?.accessTagSlugs ?? [];
}

// A new key changes which private threads a character belongs to.
async function syncCharacterRoomAccessFor(characterId) {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, locationId: true, status: true, discordUserId: true },
  });
  if (!row) return;
  after(() =>
    syncCharacterRoomAccess(prisma, row).catch((err) =>
      console.error(`Room access sync failed for ${characterId}:`, err),
    ),
  );
}

// --- The faction itself ----------------------------------------------------

async function renameFactionImpl({ name }) {
  const { session, character } = await requireActor();
  if (!character.isLeader) throw new UserError("Only the Leader can rename a faction. ‡");
  if (isUnaffiliated(character.faction)) throw new UserError("Unaffiliated can't be renamed. ‡");

  const clean = cleanName(name);
  await requireFreeName(clean, character.factionId);
  const was = character.faction.name;
  // The slug is deliberately untouched: it is what every gate in the game
  // matches on (db/lib/factionConstants.js), and a rename must not move it.
  await prisma.faction.update({ where: { id: character.factionId }, data: { name: clean } });
  await audit(session, "faction_renamed", character.id, { factionId: character.factionId, was, now: clean });
  revalidateFaction();
  return { name: clean };
}

async function secedeFactionImpl() {
  const { session, character } = await requireActor();
  if (!character.isLeader) throw new UserError("Only the Leader can secede. ‡");
  if (!character.faction.parentFactionId) throw new UserError("You answer to nobody already. ‡");

  const parent = await prisma.faction.findUnique({
    where: { id: character.faction.parentFactionId },
    select: { id: true, name: true },
  });
  await prisma.faction.update({ where: { id: character.factionId }, data: { parentFactionId: null } });
  await audit(session, "faction_seceded", character.id, {
    factionId: character.factionId,
    fromFactionId: parent?.id ?? null,
  });

  if (parent) {
    for (const officer of await officersOf(parent.id)) {
      notifyCharacter(officer, `${character.faction.name} no longer answers to ${parent.name}. ‡`);
    }
  }
  revalidateFaction();
  return { parentName: parent?.name ?? null };
}

// Founding is free and instant on purpose: the whole point is that a player
// who walks out has somewhere to walk to. The new faction inherits nothing —
// no parent, no silo, no zone — and the old one is not touched at all.
async function foundFactionImpl({ name }) {
  const { session, character } = await requireActor();
  const clean = cleanName(name);
  await requireFreeName(clean);
  const was = character.faction;

  const slug = await freeSlug(clean);
  const unaffiliated = await unaffiliatedFaction();
  const faction = await prisma.$transaction(async (tx) => {
    if (character.factionId && character.factionId !== unaffiliated.id) {
      await detachMember(tx, character, unaffiliated.id);
    }
    const created = await tx.faction.create({
      data: { slug, name: clean, zoneId: character.zoneId ?? null, foundedById: character.id },
      select: { id: true, name: true },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { factionId: created.id, isLeader: true, isTreasurer: false },
    });
    await tx.factionApplication.updateMany({
      where: { characterId: character.id, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
    return created;
  });
  await audit(session, "faction_founded", character.id, { factionId: faction.id, name: clean });

  if (was && !isUnaffiliated(was)) {
    for (const officer of await officersOf(was.id)) {
      notifyCharacter(officer, `${character.name} has left ${was.name} to found ${clean}. ‡`);
    }
  }
  revalidateFaction();
  return { name: clean };
}

// Re-pointing the silo moves NOTHING. The old room keeps whatever is in it —
// which is why the confirm on the other end says so out loud.
async function setSiloRoomImpl({ roomId }) {
  const { session, character } = await requireActor();
  if (!character.isLeader && !character.isTreasurer) throw new UserError("Only an officer can do that. ‡");
  if (isUnaffiliated(character.faction)) throw new UserError("Unaffiliated has no silo. ‡");

  const id = roomId ? roomId.toString() : null;
  let room = null;
  if (id) {
    room = await prisma.room.findUnique({
      where: { id },
      select: { id: true, name: true, location: { select: { name: true, zoneId: true, zone: { select: { name: true } } } } },
    });
    if (!room) throw new UserError("No such room. ‡");
    // A silo has to be in the faction's own zone. Otherwise deposits — which
    // are zone-scoped — would never work for anybody, and the picker would
    // happily offer a room on the far side of the map.
    const home = await prisma.faction.findUnique({
      where: { id: character.factionId },
      select: { zoneId: true, zone: { select: { name: true } } },
    });
    if (home?.zoneId && room.location.zoneId !== home.zoneId) {
      throw new UserError(
        `A silo has to be somewhere in ${home.zone?.name ?? "your own zone"} — nobody could put anything into one in ${room.location.zone?.name ?? "another zone"}. ‡`,
      );
    }
  }
  await prisma.faction.update({ where: { id: character.factionId }, data: { siloRoomId: room?.id ?? null } });
  await audit(session, "faction_silo_set", character.id, {
    factionId: character.factionId,
    roomId: room?.id ?? null,
  });

  for (const officer of await officersOf(character.factionId)) {
    if (officer.id === character.id) continue;
    notifyCharacter(
      officer,
      room
        ? `${character.faction.name} banks in ${room.name} now. ‡`
        : `${character.faction.name} has no silo any more. ‡`,
    );
  }
  revalidateFaction();
  return { roomName: room?.name ?? null };
}

// The console's twin of setTreasurer above. Same rule (a Leader delegates,
// a GM overrides) in the { ok } shape the client component needs, rather than
// the formData no-op the old server-rendered roster posted.
async function setMemberTreasurerImpl({ characterId, grant }) {
  const { session, character } = await requireActor();
  const { isGm: gm } = await getGmSession();
  if (!gm && !character.isLeader) throw new UserError("Only the Leader can do that. ‡");

  const target = await prisma.character.findUnique({
    where: { id: characterId?.toString() ?? "" },
    select: { id: true, name: true, factionId: true, discordUserId: true },
  });
  if (!target || target.factionId !== character.factionId) throw new UserError("They aren't in your faction. ‡");

  await prisma.character.update({ where: { id: target.id }, data: { isTreasurer: Boolean(grant) } });
  await audit(session, grant ? "faction_treasurer_assigned" : "faction_treasurer_revoked", target.id, {
    factionId: character.factionId,
  });
  notifyCharacter(
    target,
    grant
      ? `You are ${character.faction.name}'s Treasurer now. ‡`
      : `You are no longer ${character.faction.name}'s Treasurer. ‡`,
  );
  revalidateFaction();
  return { name: target.name };
}

export async function setMemberTreasurer(input) {
  return guarded(() => setMemberTreasurerImpl(input));
}

export async function leaveFaction() {
  return guarded(() => leaveFactionImpl());
}
export async function removeMember(input) {
  return guarded(() => removeMemberImpl(input));
}
export async function applyToFaction(input) {
  return guarded(() => applyToFactionImpl(input));
}
export async function inviteToFaction(input) {
  return guarded(() => inviteToFactionImpl(input));
}
export async function withdrawApplication(input) {
  return guarded(() => withdrawApplicationImpl(input));
}
export async function decideApplication(input) {
  return guarded(() => decideApplicationImpl(input));
}
export async function renameFaction(input) {
  return guarded(() => renameFactionImpl(input));
}
export async function secedeFaction() {
  return guarded(() => secedeFactionImpl());
}
export async function foundFaction(input) {
  return guarded(() => foundFactionImpl(input));
}
export async function setSiloRoom(input) {
  return guarded(() => setSiloRoomImpl(input));
}
