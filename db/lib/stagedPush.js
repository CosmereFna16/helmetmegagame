// The staged-arbitration push — the pass that makes "nothing a GM decides
// touches a player until the turn ends" true. It runs inside resolveNeeds()
// against the CLOSING turn and does three things, in order:
//
//   1. Applies every StagedEffect a GM queued for this turn ({ resources?,
//      tagPoints?, tagOps? } per target character).
//   2. Applies every confirmed Move's own declared numbers. Since the
//      staged-arbitration rework nothing pays at confirm time — a Routine, a
//      Labor payout and a GM-solved Gambit all sit with appliedEffects null
//      until this pass. Solve is bookkeeping; the declared resourceDelta is
//      what pays, and a GM who disagreed staged a counter-effect instead.
//   3. Silently closes every Move no GM touched (OPEN -> PASSED). That stays
//      silent for a Gambit, but a Routine that ends the push PASSED with
//      nothing written for its player gets a short canned DM saying so —
//      otherwise "no news" reads as a message that went missing.
//
// It follows the turn-pass conventions to the letter (see TURN-ENGINE.md):
// it sends nothing itself — the DMs and the summary-channel post are handed
// back for advanceTurn()'s side-effect thunk — it returns an object even
// when there was nothing to do (null means "retry me"), and every mutation
// is guarded by a conditional claim so the crash-resume path can never apply
// a row twice:
//
//   - a StagedEffect is claimed by writing appliedAt where it was null;
//   - an Action is claimed by writing appliedEffects: {} where it was SQL
//     NULL. A crash mid-transaction rolls the claim back with the work, so
//     claimed-but-unapplied cannot exist.
//
// Position in TURN_PASSES is load-bearing, see resolveNeeds().

const { Prisma } = require("@prisma/client");
const { addResources, applyMoveEffects } = require("./moveEffects");
const { TagOpError, validateTagOps, applyTagOpsInTx } = require("./tagOps");

// What a quietly passed Routine gets told. sendDm writes the » prefix itself,
// so this is raw text.
const ROUTINE_PASSED_DM =
  "Your Routine automatically passed without any special adjudication notes. " +
  "Only Gambits receive adjudications, typically. If you need additional " +
  "information or believe this was in error, message the GMs.";

// Mirrors TagOpError's role for the zone half of a staged effect: thrown from
// inside applyOneStagedEffect's transaction so the whole row (including the
// appliedAt claim) rolls back clean, then caught by runStagedPushPass and
// turned into the same "stamped errored, not silently dropped" verdict.
class StagedZoneError extends Error {}

// One transaction per row, never one around the batch: one bad row must not
// roll back a hundred good ones, and per-row scoping keeps the character row
// locks short. Returns what the row actually moved, for the appliedEffect
// snapshot.
async function applyOneStagedEffect(prisma, row, turn, equipSlots) {
  return prisma.$transaction(async (tx) => {
    // The claim IS the double-apply guard: a resumed pass re-selects
    // appliedAt: null and this updateMany comes back 0 for anything the
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

    const tagPoints = Number.isInteger(row.payload?.tagPoints) ? row.payload.tagPoints : 0;
    if (tagPoints) {
      // Unclamped on purpose: tagPoints may legitimately go negative
      // (see web/lib/characterWrite.js). The snapshot is the delta itself.
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
      // whole row back clean (including the claim). The one late thrower is
      // applyTagOpsInTx's equip-cap check — also inside this tx, also clean.
      validateTagOps(ops, tagsById, new Set(heldRows.map((r) => r.tagId)));
      // openTurn is the CLOSING turn on purpose: a 1-turn tag granted here
      // gets expiresTurn = turn.number + 1 and survives this rollover's own
      // expiry sweep, exactly like a tag granted five minutes earlier.
      snapshot.tags = await applyTagOpsInTx(tx, {
        characterId: row.targetCharacterId,
        ops,
        tagsById,
        openTurn: turn,
        equipSlots,
      });
    }

    // Raw relocation — no Action row, no Move cost, no adjacency check (same
    // semantics as the Dev Panel's zone edit and Bulk Move: this deliberately
    // does not go through performTravel). Re-verified here, inside the row's
    // own transaction, since the zone the GM picked on the desk may have
    // since been deleted or reworked into a CAVE_GROUP by a zone sync.
    const zoneId = row.payload?.zoneId ?? null;
    if (zoneId) {
      const zone = await tx.zone.findUnique({ where: { id: zoneId } });
      if (!zone || zone.kind === "CAVE_GROUP") {
        throw new StagedZoneError("That isn't a place a character can stand.");
      }
      const before = await tx.character.findUnique({
        where: { id: row.targetCharacterId },
        select: { zoneId: true },
      });
      await tx.character.update({ where: { id: row.targetCharacterId }, data: { zoneId } });
      snapshot.zone = { from: before?.zoneId ?? null, to: zoneId };
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
  // zone so a batch (or several stages against the same character) doesn't
  // churn roles on the way through — Map insertion order doesn't matter here
  // since the rows are processed in createdAt order and each overwrite wins.
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
        if (snapshot.zone) {
          const target = row.targetCharacter;
          if (target?.status === "ALIVE" && target.discordUserId) {
            const existing = zoneMovesByCharacter.get(row.targetCharacterId);
            zoneMovesByCharacter.set(row.targetCharacterId, {
              characterId: row.targetCharacterId,
              discordUserId: target.discordUserId,
              // The FIRST applied move's "from" is the character's true prior
              // zone; a later move in the same batch overwrites only "to".
              fromZoneId: existing ? existing.fromZoneId : snapshot.zone.from,
              toZoneId: snapshot.zone.to,
            });
          }
        }
      }
    } catch (err) {
      if (err instanceof TagOpError || err instanceof StagedZoneError) {
        // A GM staged something that no longer validates (the tag vanished
        // from the catalog, the target re-acquired an equip conflict, the
        // zone was deleted or reworked into a group row...). Stamp it
        // errored — payload preserved, appliedEffect says why — so the tray
        // shows a verdict rather than an eternally-pending row.
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
  // DbNull filter is what makes this a no-op for anything already paid —
  // travel stubs and pre-rework rows carry a snapshot (possibly {}) already.
  let movesApplied = 0;
  let movesClosed = 0;
  // The two includes are there for the Routine notice below and nothing else:
  // who to DM, and whether a GM already wrote this player about this Move.
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
  for (const action of unapplied) {
    // Decided inside the transaction, queued outside it — same convention as
    // the zone moves above: a commit that fails after the eligibility check
    // must not leave a "your Routine passed" DM pointing at a payout that
    // rolled back.
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

        // Decided on the Move's END state, not the one it walked in with:
        // saving the adjudication popup writes OPEN unconditionally, so a GM
        // who opened a Routine, read it and clicked Save would otherwise mute
        // the notice by accident. An "auto:" marker means another pass is
        // already DMing this player about this row (a Default Move, a travel
        // stub). And a private staged message IS the adjudication note — but
        // only when it went to this player; one about them, sent to someone
        // else, tells them nothing.
        const alreadyTold = action.stagedMessages.some((message) =>
          message.recipients.some((r) => r.characterId === action.characterId),
        );
        // A staged effect against the Move's own character is adjudication
        // attention too — their sheet is changing in this same push, and
        // "passed without any special adjudication notes" would be a lie.
        const alreadyAdjudicated = action.stagedEffects.some(
          (e) => e.targetCharacterId === action.characterId,
        );
        if (
          action.moveKind === "ROUTINE" &&
          (silentClose || action.moveReviewStatus === "PASSED") &&
          !(action.gmNotes ?? "").includes("auto:") &&
          !alreadyTold &&
          !alreadyAdjudicated &&
          action.character?.discordUserId
        ) {
          notice = {
            discordUserId: action.character.discordUserId,
            content: ROUTINE_PASSED_DM,
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
        // Every PUBLIC row is required to carry a real (non-CAVE_GROUP)
        // zone, so this is that zone's #summary channel.
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
    privateDeliveries,
    publicPosts,
    zoneMoves,
  };
}

module.exports = { runStagedPushPass };
