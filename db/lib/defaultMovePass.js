// The per-turn Default Move pass: what actually makes the "Default Move"
// panel on /character mean anything.
//
// A player sets a Default Move once and it stands until they delete it —
// "if you don't submit a Move on a given day, this is assumed instead". This
// pass is the half that assumes it: at the close of every turn, run from
// db/index.js#resolveNeeds(), every ALIVE character who has a saved
// DefaultEffort and filed nothing on the closing turn gets a Move filed for
// them.
//
// What it files is deliberately a **Routine**, resolved the same way
// bot/src/lib/moveConfirm.js#confirmMove resolves one a player
// confirms by hand: status CONFIRMED, moveReviewStatus PASSED, resources
// pushed immediately and snapshotted onto Action.appliedEffects so a GM can
// still revert it from the Moves panel. It never rolls a Gambit — a Gambit is
// a deliberate risk, not something to take on a player's behalf while they're
// asleep. It's tagged `gmNotes: "auto:default_move"`, the same identifiable
// marker performMove uses for an auto-resolved zone change.
//
// `DefaultEffort.labor` is a plain boolean now, so this needs no notation
// parsing at all — the description is stored and filed verbatim, and the
// only thing resolved per turn is the Labor rate itself, since zone (and
// therefore tier and the depths gate) can change between saves.
const { applyMoveEffects, describeMoveEffects } = require("./moveEffects");
const { resolveLaborRateFrom } = require("./laborAccess");
const { rollResourceRange } = require("./resourceDelta");
const { INCAPACITATING_SLUGS } = require("./incapacitation");

// Reproduces the #turns submission pipeline's Labor resolution, so a Default
// Move with the checkbox ticked pays exactly what the same submission by hand
// would have.
//
// Stays pure and synchronous, taking a pre-built labor context rather than a
// characterId: this runs once per character in a bulk pass, and a version
// that did its own lookups would turn one turn advance into N round trips.
// The context is null for a character whose default doesn't have Labor
// ticked.
//
// Labor somewhere it can't be done still files the Move — they did spend the
// day trying — but pays nothing, and returns a gateNote so their DM says why
// rather than leaving them to guess.
function resolveDefaultMove(def, ctx, coefficient) {
  const description = def.description;

  if (!def.labor) {
    return { description, resourceRollExpression: null, resourceRollValue: null, resourceDelta: null, gateNote: null };
  }

  const rate = ctx ? resolveLaborRateFrom(ctx, coefficient) : { ok: false, reason: null };
  if (!rate.ok) {
    return {
      description,
      resourceRollExpression: null,
      resourceRollValue: null,
      resourceDelta: null,
      gateNote: rate.reason ?? "You couldn't labor from where you were standing.",
    };
  }

  // Rolled here, not left for later: applyMoveEffects reads resourceDelta
  // only, so an unrolled expression would file the Move and pay nothing.
  const rollResult = rollResourceRange(rate.expression);
  return {
    description,
    resourceRollExpression: rate.expression,
    resourceRollValue: rollResult?.value ?? null,
    resourceDelta: rollResult?.value ?? null,
    gateNote: null,
  };
}

async function runDefaultMovePass(prisma, turn) {
  const defaults = await prisma.defaultEffort.findMany({
    where: { character: { status: "ALIVE" } },
    include: {
      character: {
        select: {
          id: true,
          name: true,
          discordUserId: true,
          zoneId: true,
          updatedAt: true,
          // zone slug + seat feed the labor gate (db/lib/laborAccess.js);
          // discordSummaryChannelId is where the summary post goes; id + name
          // stamp the archive row for that post.
          zone: {
            select: {
              id: true,
              name: true,
              slug: true,
              discordSummaryChannelId: true,
              seatZone: { select: { slug: true } },
            },
          },
        },
      },
    },
  });
  // An object, not null. Those are two different answers and the orchestrator
  // reads them as one: db/index.js gates markDone on truthiness, and its catch
  // returns null to mean "this pass FAILED, leave it unrecorded so the next
  // advance retries it". Returning null for "there was nothing to do" meant a
  // game where nobody has saved a Default Move never recorded the pass at all.
  //
  // Harmless while needsResolvedAt was stamped unconditionally. The moment
  // that stamp became conditional on every pass having landed — which is the
  // point of the resume machinery — a turn with no default efforts would be
  // picked up as unfinished forever and re-run on every subsequent advance.
  if (defaults.length === 0) {
    return { turnNumber: turn.number, filed: 0, shareable: 0, characterIds: [], posts: [], dms: [] };
  }

  // One query for the whole turn's filings rather than one per character —
  // this is the check that decides who gets skipped, and it has to scale.
  // Any Action at all counts, including an auto-resolved zone change: moving
  // zones spends the turn, so it already used up the slot a Default Move
  // would have filled.
  const acted = await prisma.action.findMany({
    where: { turnId: turn.id, characterId: { in: defaults.map((d) => d.characterId) } },
    select: { characterId: true },
  });
  const actedIds = new Set(acted.map((a) => a.characterId));

  // Every un-acted default needs its tags loaded now, not just the
  // Labor-ticked ones: the incapacitation check below runs on all of them.
  // Still one bulk query for the whole set rather than one per character —
  // same posture as the `acted` query above. Most turns this set is small,
  // but it's no longer ever empty just because nobody has Labor ticked.
  const candidateIds = defaults.filter((d) => !actedIds.has(d.characterId)).map((d) => d.characterId);

  const tagsByCharacter = new Map();
  let coefficient = 1;
  if (candidateIds.length > 0) {
    const [tagRows, config] = await Promise.all([
      prisma.characterTag.findMany({
        where: { characterId: { in: candidateIds } },
        select: { characterId: true, tag: { select: { slug: true } } },
      }),
      prisma.gameConfig.findUnique({ where: { id: 1 }, select: { productionCoefficient: true } }),
    ]);
    for (const row of tagRows) {
      if (!tagsByCharacter.has(row.characterId)) tagsByCharacter.set(row.characterId, new Set());
      tagsByCharacter.get(row.characterId).add(row.tag.slug);
    }
    coefficient = config?.productionCoefficient ?? 1;
  }

  const filed = [];

  for (const def of defaults) {
    if (actedIds.has(def.characterId)) continue;

    const tagSlugs = tagsByCharacter.get(def.characterId) ?? new Set();

    // Tied to a chair, bleeding out, stunned or long gone quiet — a Default
    // Move is "what I'd have done if I couldn't be here", not "what I'd have
    // done if I couldn't act". Silent on purpose: they didn't ask for this
    // turn, and the tag itself is the explanation.
    if ([...tagSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) continue;

    const ctx = def.labor === true
      ? {
          zoneSlug: def.character.zone?.slug ?? null,
          seatZoneSlug: def.character.zone?.seatZone?.slug ?? def.character.zone?.slug ?? null,
          tagSlugs,
        }
      : null;
    const resolved = resolveDefaultMove(def, ctx, coefficient);

    try {
      const action = await prisma.$transaction(async (tx) => {
        const row = await tx.action.create({
          data: {
            characterId: def.characterId,
            turnId: turn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "ROUTINE",
            moveReviewStatus: "PASSED",
            description: resolved.description,
            resourceDelta: resolved.resourceDelta,
            resourceRollExpression: resolved.resourceRollExpression,
            resourceRollValue: resolved.resourceRollValue,
            zoneId: def.character.zoneId ?? def.zoneId ?? null,
            gmNotes: "auto:default_move",
          },
        });
        const applied = await applyMoveEffects(tx, row);
        return tx.action.update({ where: { id: row.id }, data: { appliedEffects: applied } });
      });

      filed.push({ def, action, gateNote: resolved.gateNote });
    } catch (err) {
      console.error(`Default Move for character ${def.characterId} failed:`, err);
    }
  }

  // `shareable`, not `shared` — the rename below missed this branch, so
  // /gm/audit rendered two different shapes for default_moves_resolved.
  if (filed.length === 0) {
    return { turnNumber: turn.number, filed: 0, shareable: 0, characterIds: [], posts: [], dms: [] };
  }

  // Neither the summary posts nor the DMs are sent here. Both are per-player
  // Discord round-trips, and awaiting them inside resolveNeeds() is what makes
  // the Dev Panel's "End turn" hold the request open — the same reason the
  // Hunger pass stopped sending its own DMs. They are described here and
  // performed by advanceTurn()'s runSideEffects(), which the web action runs
  // after the response is already flushed.
  const posts = [];
  for (const { def } of filed) {
    // The channel is resolved from where the character stands NOW, not from
    // the summaryChannelId snapshotted when they saved the panel — travelling
    // should move where their Default Move is narrated. The stored id is the
    // fallback for a character with no current zone. A cave level has no
    // summary channel, so a Default Move down there simply isn't narrated.
    const channelId = def.character.zone?.discordSummaryChannelId ?? def.summaryChannelId;
    if (!def.shareInSummary || !def.summaryMessage || !channelId) continue;
    posts.push({
      channelId,
      character: def.character,
      message: def.summaryMessage,
      // Carried so runSideEffects can stamp the archive row without re-reading
      // the character. Null when the post is falling back to the stored
      // summaryChannelId, since that id doesn't tell us which zone it is.
      zoneId: def.character.zone?.id ?? null,
      zoneName: def.character.zone?.name ?? null,
    });
  }

  // One DM each: the player needs to know a turn passed and something was
  // filed for them, since they weren't there to see it.
  const dms = filed.map(({ def, action, gateNote }) => {
    const effects = describeMoveEffects(action.appliedEffects);
    // sendDm applies the `»` prefix to the first line itself — don't write
    // one here or it doubles up.
    const lines = [
      `*Your Default Move was taken for turn ${turn.number}.*`,
      `» ${action.description}`,
      // Why a standing Labor default paid nothing — they weren't there to be
      // told.
      ...(gateNote ? [`*${gateNote} No Resources were gained.*`] : []),
      ...(effects ? [`**Applied:** ${effects}`] : []),
    ];
    return { discordUserId: def.character.discordUserId, content: lines.join("\n") };
  });

  return {
    turnNumber: turn.number,
    filed: filed.length,
    // "shareable", not "shared": the posts have not been attempted yet, so a
    // count of successes isn't knowable at audit-write time any more.
    shareable: posts.length,
    characterIds: filed.map(({ def }) => def.characterId),
    posts,
    dms,
  };
}

module.exports = { runDefaultMovePass, resolveDefaultMove };
