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
// bot/src/events/interactionCreate.js#handleMoveConfirm resolves one a player
// confirms by hand: status CONFIRMED, moveReviewStatus PASSED, resources
// pushed immediately and snapshotted onto Action.appliedEffects so a GM can
// still revert it from the Moves panel. It never rolls a Gambit — a Gambit is
// a deliberate risk, not something to take on a player's behalf while they're
// asleep. It's tagged `gmNotes: "auto:default_move"`, the same identifiable
// marker performMove uses for an auto-resolved zone change.
//
// The +N / 1d6 notation in the description is parsed here rather than at save
// time, so DefaultEffort needs no extra columns and the player keeps seeing
// the text they typed. The dice are rolled per turn, which is the point of
// writing a roll instead of a flat number.
//
// Shaped like db/lib/hungerPass.js: bulk reads, one summary audit row rather
// than one per character, and — also like hungerPass — no network call of its
// own. The summary posts and DMs it wants are returned as `posts` and `dms`
// for advanceTurn()'s runSideEffects() to perform, so they can't hold the turn
// advance open. Takes `prisma` as a parameter for the same reason (see
// db/lib/dm.js).
const { parseResourceExpression, rollResourceRange } = require("./resourceDelta");
const { applyMoveEffects, describeMoveEffects } = require("./moveEffects");
const { resolveLaborRateFrom } = require("./laborAccess");

// Reproduces the #turns submission pipeline (roll first, then flat deltas) so
// a Default Move reading "+2", "5-12" or "/hunt" is worth exactly what the
// same text posted by hand would have been.
//
// Stays pure and synchronous, taking a pre-built labor context rather than a
// characterId: this runs once per character in a bulk pass, and a version
// that did its own lookups would turn one turn advance into N round trips.
// The context is null for a character whose default names no shorthand.
//
// A shorthand the character can't perform where they're standing still files
// the Move — they did spend the day trying — but pays nothing, and returns a
// gateNote so their DM says why rather than leaving them to guess.
function parseDefaultMove(text, ctx, coefficient) {
  const { description, resourceDelta, roll } = parseResourceExpression(text);

  let expression = roll?.expression ?? null;
  let gateNote = null;

  if (roll?.kind === "shorthand") {
    const rate = ctx ? resolveLaborRateFrom(ctx, roll.field, coefficient) : { ok: false, reason: null };
    if (!rate.ok) {
      return {
        description: description || text.trim(),
        resourceRollExpression: null,
        resourceRollValue: null,
        resourceDelta: resourceDelta ?? null,
        gateNote: rate.reason ?? `You couldn't ${roll.field} from where you were standing.`,
      };
    }
    expression = rate.expression;
  }

  const rollResult = expression ? rollResourceRange(expression) : null;

  return {
    description: description || text.trim(),
    resourceRollExpression: expression,
    resourceRollValue: rollResult?.value ?? null,
    resourceDelta:
      rollResult || resourceDelta != null ? (resourceDelta ?? 0) + (rollResult?.value ?? 0) : null,
    gateNote,
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
          // slug + zone name feed the labor gate (db/lib/laborAccess.js);
          // discordChannelId is where the summary post goes.
          location: { select: { discordChannelId: true, slug: true } },
          zone: { select: { name: true } },
        },
      },
    },
  });
  if (defaults.length === 0) return null;

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

  // Only defaults that actually name a "/hunt"-style shorthand need tags
  // loaded, and they're loaded in one query for all of them rather than per
  // character — same bulk-read posture as the `acted` query above. Most
  // turns this set is empty and the query never runs.
  const shorthandIds = defaults
    .filter((d) => !actedIds.has(d.characterId) && parseResourceExpression(d.description).roll?.kind === "shorthand")
    .map((d) => d.characterId);

  const tagsByCharacter = new Map();
  let coefficient = 1;
  if (shorthandIds.length > 0) {
    const [tagRows, config] = await Promise.all([
      prisma.characterTag.findMany({
        where: { characterId: { in: shorthandIds } },
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
  const shorthandSet = new Set(shorthandIds);

  const filed = [];

  for (const def of defaults) {
    if (actedIds.has(def.characterId)) continue;

    const ctx = shorthandSet.has(def.characterId)
      ? {
          locationSlug: def.character.location?.slug ?? null,
          zoneName: def.character.zone?.name ?? null,
          tagSlugs: tagsByCharacter.get(def.characterId) ?? new Set(),
        }
      : null;
    const parsed = parseDefaultMove(def.description, ctx, coefficient);

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
            description: parsed.description,
            resourceDelta: parsed.resourceDelta,
            resourceRollExpression: parsed.resourceRollExpression,
            resourceRollValue: parsed.resourceRollValue,
            zoneId: def.character.zoneId ?? def.zoneId ?? null,
            gmNotes: "auto:default_move",
          },
        });
        const applied = await applyMoveEffects(tx, row);
        return tx.action.update({ where: { id: row.id }, data: { appliedEffects: applied } });
      });

      filed.push({ def, action, gateNote: parsed.gateNote });
    } catch (err) {
      console.error(`Default Move for character ${def.characterId} failed:`, err);
    }
  }

  if (filed.length === 0) return { turnNumber: turn.number, filed: 0, shared: 0, characterIds: [] };

  // Neither the summary posts nor the DMs are sent here. Both are per-player
  // Discord round-trips, and awaiting them inside resolveNeeds() is what makes
  // the Dev Panel's "End turn" hold the request open — the same reason the
  // Hunger pass stopped sending its own DMs. They are described here and
  // performed by advanceTurn()'s runSideEffects(), which the web action runs
  // after the response is already flushed.
  const posts = [];
  for (const { def } of filed) {
    // The channel is resolved from where the character stands NOW, not from
    // the summaryChannelId snapshotted when they saved the panel — a
    // Location's plain channel IS its summary channel, so travelling should
    // move where their Default Move is narrated. The stored id is the
    // fallback for a character with no current location.
    const channelId = def.character.location?.discordChannelId ?? def.summaryChannelId;
    if (!def.shareInSummary || !def.summaryMessage || !channelId) continue;
    posts.push({ channelId, character: def.character, message: def.summaryMessage });
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
      // Why a standing "/hunt" paid nothing — they weren't there to be told.
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

module.exports = { runDefaultMovePass, parseDefaultMove };
