// The staged-arbitration push, run inside resolveNeeds() against the CLOSING
// turn: applies every StagedEffect a GM queued, pays out each confirmed
// Move's own declared numbers (nothing pays at confirm time), and silently
// closes any Move no GM touched (OPEN -> PASSED), with a canned DM for a
// Routine that closes with nothing written to its player. Sends nothing
// itself — deliveries are handed back for advanceTurn()'s side-effect thunk.
// Every mutation is claimed first (appliedAt / appliedEffects written from
// null) so the crash-resume path can never apply a row twice.
// Position in TURN_PASSES is load-bearing, see resolveNeeds().

const { Prisma } = require("@prisma/client");
const { addResources, applyMoveEffects, describeMoveEffects } = require("./moveEffects");
const { formatRangeExpression } = require("./resourceDelta");
const { TagOpError, validateTagOps, applyTagOpsInTx } = require("./tagOps");
const { applyTransfer, InsufficientResourcesError } = require("./resourceTransfer");

// The tail on a Routine nothing else spoke for. Left off when a GM staged a
// message or an effect on the Move — that IS the adjudication, and "no notes"
// would contradict the DM the player just read.
const NO_NOTES_TAIL =
  "*Your Routine passed without any special adjudication notes. Only Gambits " +
  "receive adjudications, typically. If you need additional information or " +
  "believe this was in error, message the GMs.*";

// The Routine close DM. Mirrors the Default Move DM (db/lib/defaultMovePass.js)
// and is the only place a hand-filed Routine's payout is reported, since
// nothing pays at confirm. sendDm writes the » prefix, so don't write one here.
function formatRoutineCloseDm(turn, action, applied, adjudicated) {
  const effects = describeMoveEffects(applied);
  const lines = [
    `*Your Routine for turn ${turn.number}.*`,
    `» ${action.description}`,
    ...(effects ? [`**Applied:** ${effects}`] : []),
    ...(action.resourceRollValue != null
      ? [
          `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${action.resourceRollValue > 0 ? "+" : ""}${action.resourceRollValue} ⬢`,
        ]
      : []),
    ...(adjudicated ? [] : [NO_NOTES_TAIL]),
  ];
  return lines.join("\n");
}

// The Gambit reveal. The die is rolled and stored at submit (bot/src/lib/
// moveConfirm.js) but withheld from the player until Moves lock — this DM is
// where they find out. Raw + modifier + total only, no per-contributor
// breakdown (that needs tags this pass doesn't load).
function formatGambitRollDm(turn, action) {
  const { diceRoll, diceModifier } = action;
  const mod = diceModifier ?? 0;
  const roll = mod
    ? `**${diceRoll}** (${mod > 0 ? `+${mod}` : mod}) → **${diceRoll + mod}**`
    : `**${diceRoll}**`;
  return `🎲 Your Gambit for turn ${turn.number}: ${roll}.`;
}

// Mirrors TagOpError for the zone half of a staged effect: thrown inside
// applyOneStagedEffect's transaction so the whole row rolls back clean, then
// caught by runStagedPushPass and stamped errored rather than silently dropped.
class StagedZoneError extends Error {}

// One transaction per row, never one around the batch: one bad row must not
// roll back a hundred good ones. Returns what the row actually moved, for the
// appliedEffect snapshot.
async function applyOneStagedEffect(prisma, row, turn, equipSlots) {
  return prisma.$transaction(async (tx) => {
    // The claim IS the double-apply guard: a resumed pass re-selects
    // appliedAt: null, so this updateMany comes back 0 for anything the
    // crashed run already committed.
    const claim = await tx.stagedEffect.updateMany({
      where: { id: row.id, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    if (claim.count === 0) return null;

    const snapshot = {};

    const resources = Number.isInteger(row.payload?.resources) ? row.payload.resources : 0;
    if (resources) {
      snapshot.resources = await addResources(tx, row.targetCharacterId, resources);
    }

    // A party-to-party transfer, staged from the tray's composer. Mutually
    // exclusive with `resources`.
    // Applied blind from the snapshot taken at staging time: if the party was
    // deleted since, InsufficientResourcesError stands in and stamps the row
    // Errored rather than silently dropping the ⬢.
    const transfer = row.payload?.transfer ?? null;
    if (transfer) {
      await applyTransfer(tx, {
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        ledger: {
          actorDiscordUserId: row.createdByDiscordUserId,
          actorCharacterId: null,
          actorName: "GM (Adjudication)",
          turnNumber: turn.number,
          turnPhase: turn.phase,
          note: `Staged transfer, turn ${turn.number}`,
        },
      });
      snapshot.transfer = transfer;
    }

    const tagPoints = Number.isInteger(row.payload?.tagPoints) ? row.payload.tagPoints : 0;
    if (tagPoints) {
      // Unclamped on purpose: tagPoints may legitimately go negative (see
      // web/lib/characterWrite.js). The snapshot is the delta itself.
      await tx.character.update({
        where: { id: row.targetCharacterId },
        data: { tagPoints: { increment: tagPoints } },
      });
      snapshot.tagPoints = tagPoints;
    }

    const ops = Array.isArray(row.payload?.tagOps) ? row.payload.tagOps : [];
    if (ops.length) {
      const tags = await tx.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
      const tagsById = new Map(tags.map((t) => [t.id, t]));
      const heldRows = await tx.characterTag.findMany({
        where: { characterId: row.targetCharacterId },
        select: { tagId: true },
      });
      // Validation runs before any tag write, so a TagOpError here rolls the
      // whole row back clean, including the claim.
      validateTagOps(ops, tagsById, new Set(heldRows.map((r) => r.tagId)));
      // The turn handed down is the NEXT one, not the closing one: these tags
      // land as that turn opens, so a 1-turn tag granted here survives this
      // rollover's own expiry sweep, same as one granted five minutes earlier.
      snapshot.tags = await applyTagOpsInTx(tx, {
        characterId: row.targetCharacterId,
        ops,
        tagsById,
        openTurn: { ...turn, number: turn.number + 1 },
        equipSlots,
      });
    }

    // Raw relocation — no Action row, no Move cost, no adjacency check (same
    // as the Dev Panel's location edit and Bulk Move; doesn't go through
    // performLocationMove). Re-verified here since the location may since
    // have been pruned by a zone sync. Writes zoneId alongside — the
    // denormalization contract on Character.
    const locationId = row.payload?.locationId ?? null;
    if (locationId) {
      const location = await tx.location.findUnique({ where: { id: locationId } });
      if (!location) {
        throw new StagedZoneError("That isn't a place a character can stand.");
      }
      const before = await tx.character.findUnique({
        where: { id: row.targetCharacterId },
        select: { locationId: true, zoneId: true },
      });
      await tx.character.update({
        where: { id: row.targetCharacterId },
        data: { locationId, zoneId: location.zoneId },
      });
      snapshot.location = {
        from: before?.locationId ?? null,
        to: locationId,
        fromZoneId: before?.zoneId ?? null,
        toZoneId: location.zoneId,
      };
    }

    await tx.stagedEffect.update({ where: { id: row.id }, data: { appliedEffect: snapshot } });
    return snapshot;
  });
}

async function runStagedPushPass(prisma, turn, config) {
  const equipSlots = config?.equipSlots ?? 6;
  const failures = [];

  // ── 1. GM-staged effects ─────────────────────────────────────────────────
  let effectsApplied = 0;
  // ALIVE + a real discordUserId only, deduped to each character's FINAL
  // zone so a batch doesn't churn roles on the way through — rows process in
  // createdAt order and each overwrite wins.
  const zoneMovesByCharacter = new Map();
  const stagedEffects = await prisma.stagedEffect.findMany({
    where: { turnId: turn.id, appliedAt: null },
    orderBy: { createdAt: "asc" },
    include: { targetCharacter: { select: { status: true, discordUserId: true } } },
  });
  for (const row of stagedEffects) {
    try {
      const snapshot = await applyOneStagedEffect(prisma, row, turn, equipSlots);
      if (snapshot) {
        effectsApplied += 1;
        if (snapshot.location) {
          const target = row.targetCharacter;
          if (target?.status === "ALIVE" && target.discordUserId) {
            const existing = zoneMovesByCharacter.get(row.targetCharacterId);
            zoneMovesByCharacter.set(row.targetCharacterId, {
              characterId: row.targetCharacterId,
              discordUserId: target.discordUserId,
              // The FIRST applied move's "from" is the true prior location; a
              // later move in the same batch overwrites only "to".
              fromLocationId: existing ? existing.fromLocationId : snapshot.location.from,
              toLocationId: snapshot.location.to,
            });
          }
        }
      }
    } catch (err) {
      if (err instanceof TagOpError || err instanceof StagedZoneError || err instanceof InsufficientResourcesError) {
        // A GM staged something that no longer validates (tag vanished from
        // the catalog, equip conflict, zone deleted, transfer underfunded...).
        // Stamp it errored so the tray shows a verdict, not a pending row.
        await prisma.stagedEffect
          .update({
            where: { id: row.id },
            data: { appliedAt: new Date(), appliedEffect: { error: err.message } },
          })
          .catch((markErr) => console.error(`Failed to mark staged effect ${row.id} errored:`, markErr));
        failures.push({ kind: "effect", id: row.id, characterId: row.targetCharacterId, error: err.message });
      } else {
        // Anything else (a DB hiccup) leaves the row unapplied — visible in
        // the tray's missed-push banner, retargetable to the next turn.
        console.error(`Staged effect ${row.id} failed to apply:`, err);
        failures.push({ kind: "effect", id: row.id, characterId: row.targetCharacterId, error: String(err?.message ?? err) });
      }
    }
  }
  const zoneMoves = [...zoneMovesByCharacter.values()];

  // ── 2. every confirmed Move's own declared numbers ───────────────────────
  // status CONFIRMED filters out abandoned modal drafts (PENDING_*); the
  // DbNull filter makes this a no-op for anything already paid.
  let movesApplied = 0;
  let movesClosed = 0;
  // The two includes exist only for the Routine notice below: who to DM, and
  // whether a GM already wrote this player about this Move.
  const unapplied = await prisma.action.findMany({
    where: { turnId: turn.id, status: "CONFIRMED", appliedEffects: { equals: Prisma.DbNull } },
    orderBy: { createdAt: "asc" },
    include: {
      character: { select: { discordUserId: true } },
      stagedMessages: {
        where: { kind: "PRIVATE" },
        select: { recipients: { select: { characterId: true } } },
      },
      stagedEffects: { select: { targetCharacterId: true } },
    },
  });
  const routineNotices = [];
  // Independent of the routine-closing logic below: the die was already
  // decided at submit, this pass just delivers the news. Every CONFIRMED
  // Gambit still unpaid this turn qualifies.
  // A lesson's Gambit is excluded: the lesson pass (db/lib/lessonPass.js)
  // already told the learner the die AND what it did, in one line.
  const gambitRollNotices = [];
  for (const action of unapplied) {
    if ((action.gmNotes ?? "").includes("auto:lesson")) continue;
    if (action.moveKind === "GAMBIT" && action.diceRoll != null && action.character?.discordUserId) {
      gambitRollNotices.push({
        discordUserId: action.character.discordUserId,
        content: formatGambitRollDm(turn, action),
      });
    }
  }
  for (const action of unapplied) {
    // Decided inside the transaction, queued outside it: a commit that fails
    // after the eligibility check must not leave a "your Routine passed" DM
    // pointing at a payout that rolled back.
    let notice = null;
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.action.updateMany({
          where: { id: action.id, appliedEffects: { equals: Prisma.DbNull } },
          data: { appliedEffects: {} },
        });
        if (claim.count === 0) return;
        const applied = await applyMoveEffects(tx, action);
        const silentClose = action.moveReviewStatus === "OPEN";
        await tx.action.update({
          where: { id: action.id },
          data: {
            appliedEffects: applied,
            ...(silentClose
              ? {
                  moveReviewStatus: "PASSED",
                  gmNotes: [action.gmNotes, "auto:silent_close"].filter(Boolean).join("\n"),
                }
              : {}),
          },
        });
        movesApplied += 1;
        if (silentClose) movesClosed += 1;

        // A private staged message IS the adjudication note, but only when it
        // went to this player.
        const alreadyTold = action.stagedMessages.some((message) =>
          message.recipients.some((r) => r.characterId === action.characterId),
        );
        // A staged effect against the Move's own character counts too —
        // their sheet is changing in this same push.
        const alreadyAdjudicated = action.stagedEffects.some(
          (e) => e.targetCharacterId === action.characterId,
        );
        // Neither suppresses the DM, only its "no notes" tail. The remaining
        // skip is the "auto:" family (Default Move / travel stub each send
        // their own DM) — reads pre-update gmNotes so the auto:silent_close
        // appended above can't mute the notice it's meant to accompany.
        if (
          action.moveKind === "ROUTINE" &&
          !(action.gmNotes ?? "").includes("auto:") &&
          action.character?.discordUserId
        ) {
          notice = {
            discordUserId: action.character.discordUserId,
            content: formatRoutineCloseDm(turn, action, applied, alreadyTold || alreadyAdjudicated),
          };
        }
      });
      if (notice) routineNotices.push(notice);
    } catch (err) {
      console.error(`Move payout for action ${action.id} failed:`, err);
      failures.push({ kind: "move", id: action.id, characterId: action.characterId, error: String(err?.message ?? err) });
    }
  }

  // ── 3. compose deliveries for the thunk ──────────────────────────────────
  // Read-only here: sentAt is stamped by the thunk after Discord answers, so
  // a crash between this pass and the sends leaves the rows visibly unsent
  // (the tray's missed-push banner) instead of falsely delivered.
  const unsent = await prisma.stagedMessage.findMany({
    where: { turnId: turn.id, sentAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      recipients: {
        include: {
          character: { select: { id: true, name: true, discordUserId: true } },
        },
      },
      zone: { select: { name: true, discordSummaryChannelId: true } },
    },
  });

  const privateDeliveries = [];
  const publicPosts = [];
  for (const message of unsent) {
    if (message.kind === "PUBLIC") {
      publicPosts.push({
        stagedMessageId: message.id,
        content: message.content,
        zoneName: message.zone?.name ?? null,
        // Every PUBLIC row carries a real (non-CAVE_GROUP) zone.
        zoneSummaryChannelId: message.zone?.discordSummaryChannelId ?? null,
      });
      continue;
    }
    const recipients = message.recipients.map((r) => ({
      characterId: r.character.id,
      name: r.character.name,
      discordUserId: r.character.discordUserId,
    }));
    if (!recipients.length) {
      // Every recipient cascaded away (deleted characters). Left unsent on
      // purpose — the tray shows "no recipients" and the GM decides.
      failures.push({ kind: "message", id: message.id, error: "no recipients" });
      continue;
    }
    privateDeliveries.push({
      stagedMessageId: message.id,
      content: message.content,
      recipients,
      createdByDiscordUserId: message.createdByDiscordUserId,
    });
  }

  return {
    effectsApplied,
    effectsStaged: stagedEffects.length,
    movesApplied,
    movesClosed,
    failures,
    routineNotices,
    gambitRollNotices,
    privateDeliveries,
    publicPosts,
    zoneMoves,
  };
}

module.exports = { runStagedPushPass };
