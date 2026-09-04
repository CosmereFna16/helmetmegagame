// Lessons: the Learn Skill / Teach Skill handshake (docs/systemdocs/LESSONS.md).
//
// A lesson is an Offer of kind LESSON between a teacher and a learner around
// one teachable skill. Either side may start it from their sheet; the other
// gets a DM with Accept / Decline. Accepting files BOTH Moves for the turn —
// the learner's Gambit and the teacher's Routine — and the lesson pass
// (db/lib/lessonPass.js) rolls the result at turn end. This is the game's
// first code-adjudicated Gambit: a fixed threshold on the modified die,
// nothing for a GM to narrate.
//
// Takes `prisma` as the first parameter (the db/lib/dm.js convention) and is
// NOT on the @lifeweb/db barrel; require it by path. Web files the offer and
// the bot answers the click, so everything both sides check lives here.
const { rollDie } = require("./moveEffects");
const { gambitModifierTotal } = require("./gambitModifier");
const { moveWindow } = require("./turnClock");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const {
  TEACHING_SLUG,
  LECTURING_SLUG,
  DRILL_INSTRUCTOR_SLUG,
  FIGHTING_GROUP_SLUG,
  LECTURE_CAPACITY,
  LESSON_THRESHOLD,
  DRILL_THRESHOLD,
} = require("./constants");

// What a lesson needs to know about each side. hungerStreak feeds the
// learner's Gambit modifier, same as a hand-filed Gambit.
const LESSON_CHARACTER_SELECT = {
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
      tag: { select: { id: true, slug: true, name: true, parentTagId: true, groupId: true } },
    },
  },
};

// The catalog columns teachableSkills reads.
const LESSON_CATALOG_SELECT = {
  id: true,
  slug: true,
  name: true,
  teachable: true,
  parentTagId: true,
  requiredTagId: true,
  group: { select: { slug: true, requiredTagId: true } },
  // Named conflicts (Tag.conflictsWith). Without this column a lesson is the
  // way round every conflict pair in the catalog: Soft Hands cannot BUY
  // Laboring, but could always have been taught it.
  conflictsWith: { select: { id: true } },
};

// --- eligibility ---------------------------------------------------------

function parentMap(catalog) {
  return new Map(catalog.map((t) => [t.id, t.parentTagId ?? null]));
}

// Does holding any of `heldIds` count as holding `tagId`? True when they
// hold it, or a higher tier in its own parentTagId chain (a surgeon has a
// nurse's skill). Cycle-guarded like db/lib/medicalVision.js.
function holdsTier(heldIds, tagId, parentOf) {
  for (const id of heldIds) {
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      if (cursor === tagId) return true;
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return false;
}

function heldTagIds(character) {
  return (character?.tags ?? []).map((ct) => ct.tagId ?? ct.tag?.id).filter(Boolean);
}

function heldSlugs(character) {
  return new Set((character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
}

// Holds Teaching, or Lecturing (its upgrade replaces it on the sheet).
function isTeacher(character) {
  const slugs = heldSlugs(character);
  return slugs.has(TEACHING_SLUG) || slugs.has(LECTURING_SLUG);
}

// The skills `teacher` can teach `learner` right now: teachable, held by the
// teacher (or a higher tier of it), not yet held by the learner at that tier
// or above, with the learner holding its parent tier and any gate, and with
// nothing the learner already holds named as a conflict. Same gates as buying
// it — a lesson can't skip a prerequisite the store won't, and it can't skip a
// conflict either. Soft Hands has never done a day's labor, and no amount of
// being taught changes that.
function teachableSkills(teacher, learner, catalog) {
  const parentOf = parentMap(catalog);
  const teacherHeld = heldTagIds(teacher);
  const learnerHeld = heldTagIds(learner);
  return catalog.filter((tag) => {
    if (!tag.teachable) return false;
    if (!holdsTier(teacherHeld, tag.id, parentOf)) return false;
    if (holdsTier(learnerHeld, tag.id, parentOf)) return false;
    if (tag.parentTagId && !holdsTier(learnerHeld, tag.parentTagId, parentOf)) return false;
    if (tag.requiredTagId && !holdsTier(learnerHeld, tag.requiredTagId, parentOf)) return false;
    if (tag.group?.requiredTagId && !holdsTier(learnerHeld, tag.group.requiredTagId, parentOf)) return false;
    // Exact ids, not holdsTier: a conflict is with the named tag itself, and
    // walking the chain would let one conflicting tier shut out its siblings.
    // db:sync-tags writes conflictsWith both ways, so one direction is enough.
    const held = new Set(learnerHeld);
    if ((tag.conflictsWith ?? []).some((c) => held.has(c.id))) return false;
    return true;
  });
}

// 5, or 4 for a fighting skill under a Drill Instructor. On the modified die.
function lessonThreshold(teacher, skill) {
  const drill = heldSlugs(teacher).has(DRILL_INSTRUCTOR_SLUG) && skill?.group?.slug === FIGHTING_GROUP_SLUG;
  return drill ? DRILL_THRESHOLD : LESSON_THRESHOLD;
}

// How many learners one teacher's Routine can carry this turn.
function teacherCapacity(teacher) {
  return heldSlugs(teacher).has(LECTURING_SLUG) ? LECTURE_CAPACITY : 1;
}

// --- shared checks -------------------------------------------------------

const GONE = "That offer's gone. ‡";
const LOCKED_IN = "You've already locked in a Move this turn. ‡";

async function openTurnAndWindow(db) {
  const [turn, config] = await Promise.all([
    db.turn.findFirst({ where: { status: "OPEN" } }),
    db.gameConfig.findUnique({ where: { id: 1 }, select: { autoTurnAdvanceDisabled: true } }),
  ]);
  if (!turn) return { turn: null, locked: true };
  const { locked } = moveWindow(turn, { autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false });
  return { turn, locked };
}

// A teacher's Move slot: free, or an existing lesson Routine with room on it
// (Lecturing). Returns { ok, action, reason }.
async function teacherSlot(db, teacher, turnId) {
  const action = await db.action.findFirst({ where: { characterId: teacher.id, turnId } });
  if (!action) return { ok: true, action: null };
  if (!(action.gmNotes ?? "").includes("auto:lesson")) return { ok: false, reason: `${teacher.name} has already locked in a Move this turn. ‡` };
  const taken = await db.offer.count({
    where: { teacherActionId: action.id, status: { in: ["ACCEPTED", "RESOLVED"] } },
  });
  if (taken >= teacherCapacity(teacher)) {
    return { ok: false, reason: `${teacher.name} can't take on another student this turn. ‡` };
  }
  return { ok: true, action };
}

async function learnerSlot(db, learner, turnId) {
  const action = await db.action.findFirst({ where: { characterId: learner.id, turnId }, select: { id: true } });
  return action ? { ok: false, reason: `${learner.name} has already locked in a Move this turn. ‡` } : { ok: true };
}

// Everything a lesson needs true, checked the same way at offer time and
// again at accept time. `initiatorId` decides whose Move slot is checked
// now (at accept, both are).
async function validateLesson(db, { teacher, learner, tag, turnId, checkSlotsFor }) {
  if (!teacher || teacher.status !== "ALIVE") return "That teacher isn't around any more. ‡";
  if (!learner || learner.status !== "ALIVE") return "That student isn't around any more. ‡";
  if (teacher.id === learner.id) return "You can't teach yourself. ‡";
  if (!isHere(teacher, learner)) return notHereMessage(learner);
  if (!isHere(learner, teacher)) return notHereMessage(teacher);
  if (!isTeacher(teacher)) return `${teacher.name} can't teach. ‡`;
  if (!tag) return "Unknown skill. ‡";
  const catalog = await db.tag.findMany({ select: LESSON_CATALOG_SELECT });
  if (!teachableSkills(teacher, learner, catalog).some((t) => t.id === tag.id)) {
    return `${teacher.name} can't teach ${learner.name} ${tag.name} right now. ‡`;
  }
  for (const who of checkSlotsFor) {
    const slot = who === teacher.id ? await teacherSlot(db, teacher, turnId) : await learnerSlot(db, learner, turnId);
    if (!slot.ok) return slot.reason;
  }
  return null;
}

async function loadCharacter(db, id) {
  if (!id) return null;
  return db.character.findUnique({ where: { id }, select: LESSON_CHARACTER_SELECT });
}

// --- the offer -------------------------------------------------------------

// Files a PENDING offer and returns the DM to send the responder. The
// initiator is whichever side pressed the button; the other side answers.
// Returns { ok: true, offer, dm: { discordUserId, content, components } } or
// { ok: false, reason }.
async function createLessonOffer(prisma, { initiatorId, teacherId, learnerId, tagId, reason = null }) {
  const { turn, locked } = await openTurnAndWindow(prisma);
  if (!turn) return { ok: false, reason: "No turn is open. ‡" };
  if (locked) return { ok: false, reason: "Moves are locked for this turn. ‡" };

  const [teacher, learner, tag] = await Promise.all([
    loadCharacter(prisma, teacherId),
    loadCharacter(prisma, learnerId),
    tagId ? prisma.tag.findUnique({ where: { id: tagId }, select: LESSON_CATALOG_SELECT }) : null,
  ]);
  if (initiatorId !== teacherId && initiatorId !== learnerId) return { ok: false, reason: "That isn't your lesson. ‡" };

  const problem = await validateLesson(prisma, { teacher, learner, tag, turnId: turn.id, checkSlotsFor: [initiatorId] });
  if (problem) return { ok: false, reason: problem };

  const responder = initiatorId === teacherId ? learner : teacher;
  if (!responder.discordUserId) return { ok: false, reason: `${responder.name} can't be reached. ‡` };

  const duplicate = await prisma.offer.findFirst({
    where: { kind: "LESSON", status: "PENDING", turnId: turn.id, teacherId, learnerId, tagId },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "That offer is already waiting on an answer. ‡" };

  const offer = await prisma.offer.create({
    data: {
      kind: "LESSON",
      turnId: turn.id,
      initiatorId,
      responderId: responder.id,
      teacherId,
      learnerId,
      tagId,
      reason,
    },
  });

  const content =
    initiatorId === learnerId
      ? // Bascinet's line.
        `*${learner.name}* wants to try and learn *${tag.name}* from you. Accept?`
      : `*${teacher.name}* offers to teach you *${tag.name}*. Accept? ‡`;
  return {
    ok: true,
    offer,
    dm: { discordUserId: responder.discordUserId, content, components: offerButtonRow(offer.id) },
  };
}

// --- accepting -------------------------------------------------------------

function confirmLines(action, teacherName, learnerName) {
  return action.moveKind === "GAMBIT"
    ? [
        `» ${action.description}`,
        "Kind: **Gambit**",
        "🎲 *The die is cast. You'll see how it fell when the turn ends.*",
        "» *Locked in. Results land when the turn ends.*",
      ].join("\n")
    : [`» ${action.description}`, "Kind: **Routine**", "» *Locked in. Results land when the turn ends.*"].join("\n");
}

// Claims the offer and files both Moves in one transaction. Returns
// { ok: true, dms: [{ discordUserId, content }], line } — `line` is what the
// responder's own DM gets edited to say — or { ok: false, reason }.
//
// Order matters. A stale click (the offer already ACCEPTED, DECLINED or
// EXPIRED) is answered "gone" before anything else is looked at: the checks
// below would otherwise see the teacher's own lesson Routine as "no room"
// and cancel a lesson that was already under way. A failure BEFORE the claim
// cancels the offer only while it is still PENDING; a failure AFTER the
// claim is the claimant's own and cancels the ACCEPTED row it just made.
async function acceptLesson(prisma, offer, responder) {
  const fresh = await prisma.offer.findUnique({ where: { id: offer.id } });
  if (!fresh || fresh.status !== "PENDING") return { ok: false, reason: GONE, dms: [] };

  const { turn, locked } = await openTurnAndWindow(prisma);
  if (!turn || turn.id !== offer.turnId) return await cancelWith(prisma, offer, "That offer was for a turn that's over. ‡");
  if (locked) return await cancelWith(prisma, offer, "Moves are locked for this turn. ‡");

  const [teacher, learner, tag] = await Promise.all([
    loadCharacter(prisma, offer.teacherId),
    loadCharacter(prisma, offer.learnerId),
    offer.tagId ? prisma.tag.findUnique({ where: { id: offer.tagId }, select: LESSON_CATALOG_SELECT }) : null,
  ]);
  const problem = await validateLesson(prisma, {
    teacher,
    learner,
    tag,
    turnId: turn.id,
    checkSlotsFor: [teacher?.id, learner?.id].filter(Boolean),
  });
  if (problem) return await cancelWith(prisma, offer, problem);

  const threshold = lessonThreshold(teacher, tag);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The claim: PENDING -> ACCEPTED, or someone else already answered.
      const claim = await tx.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (claim.count === 0) return { ok: false, reason: GONE };

      // The learner's Gambit. @@unique([characterId, turnId]) is the real
      // gate; the slot checks above were the polite version.
      const learnerAction = await tx.action.create({
        data: {
          characterId: learner.id,
          turnId: turn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          description: `Learning ${tag.name} from ${teacher.name}. ‡`,
          diceRoll: rollDie(),
          diceModifier: gambitModifierTotal(learner.tags, { hungerStreak: learner.hungerStreak }),
          zoneId: learner.zoneId ?? null,
          gmNotes: "auto:lesson",
        },
      });

      // The teacher's Routine: new, or a Lecturer's existing one widened.
      const slot = await teacherSlot(tx, teacher, turn.id);
      if (!slot.ok) throw new LessonRefused(slot.reason);
      let teacherAction = slot.action;
      if (!teacherAction) {
        teacherAction = await tx.action.create({
          data: {
            characterId: teacher.id,
            turnId: turn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "ROUTINE",
            moveReviewStatus: "PASSED",
            description: `Teaching ${tag.name} to ${learner.name}. ‡`,
            appliedEffects: {},
            zoneId: teacher.zoneId ?? null,
            gmNotes: "auto:lesson",
          },
        });
      } else {
        const base = teacherAction.description.replace(/\.\s*‡?\s*$/, "");
        teacherAction = await tx.action.update({
          where: { id: teacherAction.id },
          data: { description: `${base}, ${tag.name} to ${learner.name}. ‡` },
        });
      }

      await tx.offer.update({
        where: { id: offer.id },
        data: { threshold, learnerActionId: learnerAction.id, teacherActionId: teacherAction.id },
      });

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: responder.discordUserId ?? "system",
          actionType: "lesson_accepted",
          targetCharacterId: learner.id,
          details: {
            offerId: offer.id,
            teacherId: teacher.id,
            teacherName: teacher.name,
            learnerId: learner.id,
            learnerName: learner.name,
            tagId: tag.id,
            tagName: tag.name,
            threshold,
            learnerActionId: learnerAction.id,
            teacherActionId: teacherAction.id,
          },
        },
      });

      return { ok: true, learnerAction, teacherAction };
    });
    if (!result.ok) return result;

    const learnerLines = confirmLines(result.learnerAction);
    const teacherLines = confirmLines(result.teacherAction);
    const responderIsLearner = responder.id === learner.id;
    return {
      ok: true,
      line: responderIsLearner ? learnerLines : teacherLines,
      dms: [
        responderIsLearner
          ? { discordUserId: teacher.discordUserId, content: `${learner.name} accepted. ‡\n${teacherLines}` }
          : { discordUserId: learner.discordUserId, content: `${teacher.name} accepted. ‡\n${learnerLines}` },
      ].filter((dm) => dm.discordUserId),
    };
  } catch (err) {
    if (err instanceof LessonRefused) return await cancelWith(prisma, offer, err.message, { claimed: true });
    if (err?.code === "P2002") return await cancelWith(prisma, offer, LOCKED_IN, { claimed: true });
    throw err;
  }
}

class LessonRefused extends Error {}

// Marks the offer CANCELLED and hands back the reason plus a DM for the
// initiator, so a refusal at accept time doesn't leave them waiting on an
// answer that already came. Before the claim only a PENDING row may be
// cancelled — a concurrent click that already accepted must not be undone
// by a slower one. `claimed` is the claimant's own post-claim failure.
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
      ? [{ discordUserId: initiator.discordUserId, content: `Your offer fell through: ${reason}` }]
      : [],
  };
}

// --- declining -------------------------------------------------------------

async function declineOffer(prisma, offer, responder) {
  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: GONE, dms: [] };
  const initiator = await prisma.character.findUnique({
    where: { id: offer.initiatorId },
    select: { discordUserId: true },
  });
  const content =
    offer.kind === "BIND" ? `${responder.name} won't be bound. ‡` : `${responder.name} declined the lesson. ‡`;
  return {
    ok: true,
    line: offer.kind === "BIND" ? "You said no. ‡" : "You passed on the lesson. ‡",
    dms: initiator?.discordUserId ? [{ discordUserId: initiator.discordUserId, content }] : [],
  };
}

// --- cancellation hooks ------------------------------------------------------

// A GM rejected (deleted) an Action. A learner's Gambit going means the
// lesson is off; a teacher's Routine going takes every lesson on it, and the
// learners' Gambits with it — they can't learn from nobody. Returns the DMs
// owed. Runs inside the caller's transaction, BEFORE the Action row is deleted.
async function cancelOffersForAction(tx, actionId) {
  const offers = await tx.offer.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ learnerActionId: actionId }, { teacherActionId: actionId }],
    },
  });
  const dms = [];
  for (const offer of offers) {
    await tx.offer.update({
      where: { id: offer.id },
      data: { status: "CANCELLED", resolvedAt: new Date(), outcome: { cancelledBy: "gm_reject" } },
    });
    if (offer.teacherActionId === actionId && offer.learnerActionId) {
      // The learner's Gambit has no lesson behind it any more.
      await tx.action.deleteMany({ where: { id: offer.learnerActionId } });
      const learner = await tx.character.findUnique({
        where: { id: offer.learnerId },
        select: { discordUserId: true },
      });
      const teacher = await tx.character.findUnique({ where: { id: offer.teacherId }, select: { name: true } });
      if (learner?.discordUserId) {
        dms.push({
          discordUserId: learner.discordUserId,
          content: `Your lesson with ${teacher?.name ?? "your teacher"} was called off by a GM. Your Move is free again. ‡`,
        });
      }
    }
  }
  return dms;
}

// Death: a PENDING offer either way is void. An ACCEPTED lesson still
// resolves — it happened when it was accepted.
async function cancelOffersForCharacter(db, characterId) {
  await db.offer.updateMany({
    where: { status: "PENDING", OR: [{ initiatorId: characterId }, { responderId: characterId }] },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
}

module.exports = {
  LESSON_CHARACTER_SELECT,
  LESSON_CATALOG_SELECT,
  teachableSkills,
  lessonThreshold,
  teacherCapacity,
  isTeacher,
  holdsTier,
  createLessonOffer,
  acceptLesson,
  declineOffer,
  cancelOffersForAction,
  cancelOffersForCharacter,
};
