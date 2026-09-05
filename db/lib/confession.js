// Confession: the Confess handshake (docs/systemdocs/CONFESSION.md).
//
// A confession is an Offer of kind CONFESSION between a penitent and a
// chaplain around one of the penitent's `psychological` tags. Only the
// PENITENT ever starts one — that asymmetry is the whole design. A chaplain
// with a "hear confession" menu would be reading the addictions off everyone
// standing near them before agreeing to hear a word, so there is no such
// menu, and the Accept DM the chaplain gets NEVER NAMES THE TAG. They agree
// to hear a confession, not to hear that one.
//
// Accepting files both Moves for the turn — the penitent's Gambit and the
// chaplain's Routine — and db/lib/confessionPass.js rolls it at turn end.
// Structurally this is db/lib/lessons.js with the teacher's menu amputated;
// read LESSONS.md first, then this file for the deltas.
//
// Takes `prisma` as the first parameter (the db/lib/dm.js convention) and is
// NOT on the @lifeweb/db barrel; require it by path.
const { rollDie } = require("./moveEffects");
const { gambitModifierTotal } = require("./gambitModifier");
const { moveWindow } = require("./turnClock");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { CHAPLAIN_SLUG, CONFESSION_THRESHOLD } = require("./constants");

// What a confession needs to know about each side. hungerStreak feeds the
// penitent's Gambit modifier, same as a hand-filed Gambit.
const CONFESSION_CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  zoneId: true,
  concealed: true,
  buriedAt: true,
  discordUserId: true,
  hungerStreak: true,
  tags: {
    select: {
      tagId: true,
      quantity: true,
      tag: {
        select: { id: true, slug: true, name: true, psychological: true },
      },
    },
  },
};

// --- eligibility ---------------------------------------------------------

function heldSlugs(character) {
  return new Set(
    (character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
  );
}

// Bishop and Chaplain both hold the tag; neither the Bishop role nor the
// Chaplain role is checked anywhere here.
function isChaplain(character) {
  return heldSlugs(character).has(CHAPLAIN_SLUG);
}

// The penitent's own confessable tags: the ones flagged `psychological` in
// docs/tags.yaml. Nothing about the chaplain narrows this — a chaplain is a
// chaplain — so unlike teachableSkills it takes one character.
function confessableTags(penitent) {
  return (penitent?.tags ?? [])
    .map((ct) => ct.tag)
    .filter((tag) => tag?.psychological)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- shared checks -------------------------------------------------------

const GONE = "That confession's gone. ‡";
const LOCKED_IN = "You've already locked in a Move this turn. ‡";

async function openTurnAndWindow(db) {
  const [turn, config] = await Promise.all([
    db.turn.findFirst({ where: { status: "OPEN" } }),
    db.gameConfig.findUnique({
      where: { id: 1 },
      select: { autoTurnAdvanceDisabled: true },
    }),
  ]);
  if (!turn) return { turn: null, locked: true };
  const { locked } = moveWindow(turn, {
    autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
  });
  return { turn, locked };
}

// One confession is one whole Routine. There is no Lecturing here: a chaplain
// hears one person a day, and a queue of penitents is the point.
async function freeSlot(db, character, turnId) {
  const action = await db.action.findFirst({
    where: { characterId: character.id, turnId },
    select: { id: true },
  });
  return action
    ? {
        ok: false,
        reason: `${character.name} has already locked in a Move this turn. ‡`,
      }
    : { ok: true };
}

// Everything a confession needs true, checked the same way at offer time and
// again at accept time. `checkSlotsFor` is the penitent alone at offer time
// and both at accept time.
async function validateConfession(
  db,
  { chaplain, penitent, tag, turnId, checkSlotsFor },
) {
  if (!chaplain || chaplain.status !== "ALIVE")
    return "That chaplain isn't around any more. ‡";
  if (!penitent || penitent.status !== "ALIVE")
    return "That penitent isn't around any more. ‡";
  if (chaplain.id === penitent.id) return "You can't confess to yourself. ‡";
  if (!isHere(chaplain, penitent)) return notHereMessage(penitent);
  if (!isHere(penitent, chaplain)) return notHereMessage(chaplain);
  if (!isChaplain(chaplain))
    return `${chaplain.name} can't take a confession. ‡`;
  if (!tag) return "Unknown burden. ‡";
  // Re-derived from the penitent's own row, never trusted from the client:
  // they must still hold it, and it must still be a psychological one.
  if (!confessableTags(penitent).some((t) => t.id === tag.id)) {
    return `That isn't something ${penitent.name} can confess. ‡`;
  }
  for (const who of checkSlotsFor) {
    const slot = await freeSlot(
      db,
      who === chaplain.id ? chaplain : penitent,
      turnId,
    );
    if (!slot.ok) return slot.reason;
  }
  return null;
}

async function loadCharacter(db, id) {
  if (!id) return null;
  return db.character.findUnique({
    where: { id },
    select: CONFESSION_CHARACTER_SELECT,
  });
}

// --- the offer -------------------------------------------------------------

// Files a PENDING offer and returns the DM to send the chaplain. Returns
// { ok: true, offer, dm: { discordUserId, content, components } } or
// { ok: false, reason }.
//
// `initiatorId` is always the penitent. The chaplain has no door into this
// function, on purpose.
async function createConfessionOffer(
  prisma,
  { penitentId, chaplainId, tagId, reason = null },
) {
  const { turn, locked } = await openTurnAndWindow(prisma);
  if (!turn) return { ok: false, reason: "No turn is open. ‡" };
  if (locked) return { ok: false, reason: "Moves are locked for this turn. ‡" };

  const [chaplain, penitent, tag] = await Promise.all([
    loadCharacter(prisma, chaplainId),
    loadCharacter(prisma, penitentId),
    tagId
      ? prisma.tag.findUnique({
          where: { id: tagId },
          select: { id: true, name: true, psychological: true },
        })
      : null,
  ]);

  const problem = await validateConfession(prisma, {
    chaplain,
    penitent,
    tag,
    turnId: turn.id,
    checkSlotsFor: [penitentId],
  });
  if (problem) return { ok: false, reason: problem };

  if (!chaplain.discordUserId)
    return { ok: false, reason: `${chaplain.name} can't be reached. ‡` };

  const duplicate = await prisma.offer.findFirst({
    where: {
      kind: "CONFESSION",
      status: "PENDING",
      turnId: turn.id,
      learnerId: penitentId,
      teacherId: chaplainId,
    },
    select: { id: true },
  });
  if (duplicate)
    return {
      ok: false,
      reason: "That confession is already waiting on an answer. ‡",
    };

  const offer = await prisma.offer.create({
    data: {
      kind: "CONFESSION",
      turnId: turn.id,
      initiatorId: penitentId,
      responderId: chaplainId,
      // The chaplain sits in teacherId and the penitent in learnerId, so the
      // Routine/Gambit columns line up with the Lesson ones and the shared
      // GM-reject hook needs no special case.
      teacherId: chaplainId,
      learnerId: penitentId,
      tagId,
      reason,
    },
  });

  // The tag is deliberately absent from this line. Naming it here would put
  // the sin in the chaplain's DMs before they had agreed to hear it.
  const content = `*${penitent.name}* wants to confess to you. Accept? ‡`;
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: chaplain.discordUserId,
      content,
      components: offerButtonRow(offer.id),
    },
  };
}

// --- accepting -------------------------------------------------------------

function confirmLines(action) {
  return action.moveKind === "GAMBIT"
    ? [
        `» ${action.description}`,
        "Kind: **Gambit**",
        "🎲 *The die is cast. You'll see how it fell when the turn ends.*",
        "» *Locked in. Results land when the turn ends.*",
      ].join("\n")
    : [
        `» ${action.description}`,
        "Kind: **Routine**",
        "» *Locked in. Results land when the turn ends.*",
      ].join("\n");
}

class ConfessionRefused extends Error {}

// Claims the offer and files both Moves in one transaction. Returns
// { ok: true, dms, line } — `line` is what the chaplain's own DM gets edited
// to say — or { ok: false, reason }. Same ordering rule as acceptLesson: a
// stale click is answered "gone" before anything else is looked at.
async function acceptConfession(prisma, offer, responder) {
  const fresh = await prisma.offer.findUnique({ where: { id: offer.id } });
  if (!fresh || fresh.status !== "PENDING")
    return { ok: false, reason: GONE, dms: [] };

  const { turn, locked } = await openTurnAndWindow(prisma);
  if (!turn || turn.id !== offer.turnId) {
    return await cancelWith(
      prisma,
      offer,
      "That confession was for a turn that's over. ‡",
    );
  }
  if (locked)
    return await cancelWith(prisma, offer, "Moves are locked for this turn. ‡");

  const [chaplain, penitent, tag] = await Promise.all([
    loadCharacter(prisma, offer.teacherId),
    loadCharacter(prisma, offer.learnerId),
    offer.tagId
      ? prisma.tag.findUnique({
          where: { id: offer.tagId },
          select: { id: true, name: true, psychological: true },
        })
      : null,
  ]);
  const problem = await validateConfession(prisma, {
    chaplain,
    penitent,
    tag,
    turnId: turn.id,
    checkSlotsFor: [chaplain?.id, penitent?.id].filter(Boolean),
  });
  if (problem) return await cancelWith(prisma, offer, problem);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (claim.count === 0) return { ok: false, reason: GONE };

      // The penitent's Gambit. @@unique([characterId, turnId]) is the real
      // gate; the slot checks above were the polite version.
      const penitentAction = await tx.action.create({
        data: {
          characterId: penitent.id,
          turnId: turn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          description: `Confessing ${tag.name} to ${chaplain.name}. ‡`,
          diceRoll: rollDie(),
          diceModifier: gambitModifierTotal(penitent.tags, {
            hungerStreak: penitent.hungerStreak,
          }),
          zoneId: penitent.zoneId ?? null,
          gmNotes: "auto:confession",
        },
      });

      // The chaplain's Routine. Its description names the penitent but NOT
      // the tag — this string reaches the chaplain's own DM. A GM reading
      // /gm/turns sees the penitent's Gambit right beside it, which does.
      const chaplainAction = await tx.action.create({
        data: {
          characterId: chaplain.id,
          turnId: turn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "ROUTINE",
          moveReviewStatus: "PASSED",
          description: `Hearing ${penitent.name}'s confession. ‡`,
          appliedEffects: {},
          zoneId: chaplain.zoneId ?? null,
          gmNotes: "auto:confession",
        },
      });

      await tx.offer.update({
        where: { id: offer.id },
        data: {
          threshold: CONFESSION_THRESHOLD,
          learnerActionId: penitentAction.id,
          teacherActionId: chaplainAction.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: responder.discordUserId ?? "system",
          actionType: "confession_accepted",
          targetCharacterId: penitent.id,
          details: {
            offerId: offer.id,
            chaplainId: chaplain.id,
            chaplainName: chaplain.name,
            penitentId: penitent.id,
            penitentName: penitent.name,
            tagId: tag.id,
            tagName: tag.name,
            threshold: CONFESSION_THRESHOLD,
            penitentActionId: penitentAction.id,
            chaplainActionId: chaplainAction.id,
          },
        },
      });

      return { ok: true, penitentAction, chaplainAction };
    });
    if (!result.ok) return result;

    return {
      ok: true,
      line: confirmLines(result.chaplainAction),
      dms: [
        {
          discordUserId: penitent.discordUserId,
          content: `${chaplain.name} will hear you. ‡\n${confirmLines(result.penitentAction)}`,
        },
      ].filter((dm) => dm.discordUserId),
    };
  } catch (err) {
    if (err instanceof ConfessionRefused)
      return await cancelWith(prisma, offer, err.message, { claimed: true });
    if (err?.code === "P2002")
      return await cancelWith(prisma, offer, LOCKED_IN, { claimed: true });
    throw err;
  }
}

// Marks the offer CANCELLED and hands back a DM for the penitent, so a
// refusal at accept time doesn't leave them waiting. Before the claim only a
// PENDING row may be cancelled; `claimed` is the claimant's own post-claim
// failure. Same shape as lessons.js#cancelWith.
async function cancelWith(prisma, offer, reason, { claimed = false } = {}) {
  await prisma.offer.updateMany({
    where: { id: offer.id, status: claimed ? "ACCEPTED" : "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  const initiator = await prisma.character.findUnique({
    where: { id: offer.initiatorId },
    select: { discordUserId: true },
  });
  return {
    ok: false,
    reason,
    dms: initiator?.discordUserId
      ? [
          {
            discordUserId: initiator.discordUserId,
            content: `Your confession fell through: ${reason}`,
          },
        ]
      : [],
  };
}

module.exports = {
  CONFESSION_CHARACTER_SELECT,
  isChaplain,
  confessableTags,
  createConfessionOffer,
  acceptConfession,
};
