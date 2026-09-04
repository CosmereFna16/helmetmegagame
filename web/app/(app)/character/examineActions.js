"use server";

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { concealedAlias, withArticle } from "@lifeweb/db/lib/concealedIdentity";
import { EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire } from "@lifeweb/db/lib/examine";
import { buildSkillAncestry, satisfiedSkillIds } from "@lifeweb/db/lib/medicalVision";
import { getMyFactionRole } from "@lifeweb/db/lib/factionPermissions";
import { forcedNameFrom } from "@lifeweb/db/lib/presentedIdentity";
import { examineBlock } from "@lifeweb/db/lib/examineVision";

// Examine — looking at somebody standing where you stand. The second control
// on the Actions grid that files no Request (see ReadDialog.js for the first):
// it moves nothing, costs nothing, spends no Move and can be done as often as
// you like, because reading a room is not an act. Nothing is undoable because
// nothing was done.
//
// It exists because 🔍 hangs off a proxied message, so until now you could
// only look at someone who had SPOKEN. That was never a hiding rule, just a
// consequence of attaching the feature to a reaction — a guard on a gate could
// not size up a silent traveller without first striking up a conversation.
// /conceal is the actual hiding rule, and it still works here exactly as it
// works on 🔍: you get the hood's impoverished read.
//
// The readout itself is db/lib/examine.js, shared with the reaction handler so
// the two surfaces cannot drift on the doctor's eye, Inscrutable, or what
// "visible" means.

// The looker, from the session and never from a posted id — a server action is
// a public endpoint.
async function looker() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      locationId: true,
      factionId: true,
      discordUserId: true,
      // `equipped` and the Location's roof are here for examineVision.js: a
      // pair of spectacles only corrects your sight while you are wearing it,
      // and Sun Sensitivity only blinds you outdoors.
      tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
      location: { select: { indoors: true } },
    },
  });
  if (!me) throw new UserError("No living character. ‡");
  return me;
}

// The vision gate, asked before either action below does any work. The greyed
// button on the sheet is a hint; this is the lock (see the metagaming note in
// web/app/components/actionRegistry.js).
async function blockedFromLooking(me) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { phase: true } });
  return examineBlock(me.tags, { phase: openTurn?.phase ?? null, indoors: me.location?.indoors ?? true });
}

// Who you can look at: everyone ALIVE standing at your Location, INCLUDING the
// concealed.
//
// This is the one people-picker on the sheet that does not use peopleHere()
// (db/lib/presence.js), and the divergence is deliberate. Every other action
// there acts ON someone, which means identifying them, so a hood takes you off
// the list. Looking at a hooded figure is the whole point of a hood — and the
// Who's here? button in Discord already lists them, as "a young man", so this
// leaks no presence that the game does not already publish at Location grain.
//
// Fetched when the dialog opens rather than baked into the page render, so the
// roster is current and the sheet never carries a list of who is nearby.
export async function peopleToExamine() {
  return guarded(async () => {
    const me = await looker();
    if (!me.locationId) return { people: [] };

    // Refused here as well as in examineCharacter(), so a blinded player never
    // gets a roster of who is standing around them as a consolation prize.
    const blocked = await blockedFromLooking(me);
    if (blocked) throw new UserError(blocked);

    const present = await prisma.character.findMany({
      where: { status: "ALIVE", locationId: me.locationId, id: { not: me.id } },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: {
        id: true,
        name: true,
        concealed: true,
        age: true,
        gender: true,
        tags: {
          where: { tag: { forcedName: { not: null } } },
          select: { tag: { select: { forcedName: true } } },
        },
      },
    });

    // Named first, hoods after — the same two-part shape Who's here? prints,
    // and for the same reason: a hood is a different kind of entry, not a
    // person whose name you have merely forgotten. A forced name (Apex Form)
    // outranks concealment and lists as itself.
    return {
      people: present.map((c) => {
        const forcedName = forcedNameFrom(c.tags);
        const concealed = c.concealed && !forcedName;
        return {
          id: c.id,
          label: forcedName ?? (concealed ? withArticle(concealedAlias(c).toLowerCase()) : c.name),
          concealed,
        };
      }),
    };
  });
}

// One look. Re-resolves the subject and re-checks co-presence server-side: the
// dialog's list can outlive the player walking out of the Location, the same
// posture every picker on this sheet takes.
export async function examineCharacter(targetId) {
  return guarded(async () => {
    const me = await looker();

    const blocked = await blockedFromLooking(me);
    if (blocked) throw new UserError(blocked);

    const subject = await prisma.character.findFirst({
      // Co-presence is the whole gate, and it is in the WHERE clause rather
      // than a check afterwards so a miss is indistinguishable from "no such
      // character" — a probe for somebody's id learns nothing about where they
      // are standing.
      where: { id: targetId ?? "", status: "ALIVE", locationId: me.locationId ?? "", NOT: { id: me.id } },
      select: EXAMINE_SUBJECT_SELECT,
    });
    if (!subject) throw new UserError("They aren't here. ‡");

    const [openTurn, skillCatalog] = await Promise.all([
      prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
      // Tier chain: holding Medical (Expert) must satisfy a requirement
      // written against Medical (Basic).
      prisma.tag.findMany({ select: { id: true, parentTagId: true } }),
    ]);

    // A hood gets the impoverished read and nothing else, so neither query
    // below is worth running for one. A forced name (Apex Form) is NOT a hood
    // — a Beast is being something, not hiding — which is why this asks the
    // same question presentedIdentity does rather than reading `concealed`.
    const hidden = subject.concealed && !forcedNameFrom(subject.tags);

    // A Leader/Treasurer of the SUBJECT's faction sees their ⬢, the same seat
    // /faction's roster column reads.
    const officer =
      !hidden && subject.factionId
        ? (await getMyFactionRole(prisma, me.discordUserId, subject.factionId)).isOfficer
        : false;

    // Only queried when the viewer holds the sight that renders the field.
    const lastDesire =
      !hidden && canSeeDesire(me.tags)
        ? await prisma.desire.findFirst({
            where: { characterId: subject.id, status: "FULFILLED" },
            orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
            select: { text: true, points: true },
          })
        : null;

    return {
      readout: examineReadout({
        subject,
        viewerTags: me.tags,
        satisfied: satisfiedSkillIds(
          me.tags.map((ct) => ct.tagId),
          buildSkillAncestry(skillCatalog),
        ),
        openTurnNumber: openTurn?.number,
        lastDesire,
        viewerFactionId: me.factionId,
        viewerIsOfficer: officer,
      }),
    };
  });
}
