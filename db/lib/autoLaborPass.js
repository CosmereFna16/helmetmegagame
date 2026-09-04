// The per-turn auto-labor pass, run from db/index.js#resolveNeeds(): files a
// Labor for every ALIVE character who filed nothing on the closing turn and is
// able to work.
//
// This replaces the old Default Move pass. There is no standing order to save
// any more — not acting IS the order, and what it buys you is a day's work.
// The consequence worth stating out loud: filing a Routine or a Gambit now
// COSTS you your labor, because Labor is a third kind of Move rather than a
// checkbox riding along with one.
//
// Files a Labor resolved like the hand-filed kind: status CONFIRMED,
// moveReviewStatus PASSED (nothing here is arbitrated), resources applied and
// snapshotted onto Action.appliedEffects so a GM can revert it, gmNotes tagged
// "auto:labor". See docs/systemdocs/LABORING.md.
const { applyMoveEffects, describeMoveEffects } = require("./moveEffects");
const {
  canLaborAtAll,
  formatLaborBonusNote,
  laborTierLabel,
  resolveLaborRateFrom,
  structureTools,
  toolsFrom,
  yieldMap,
} = require("./laborAccess");
const { placementOf } = require("./structures");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { isRefinery, loadRefineryStashes, refineryInputFor } = require("./refinery");
const { LIFEWEB_SPUTTER_THRESHOLD } = require("./lifeweb");

// What the filed Move says it was. A player who wasn't there didn't narrate
// anything, and inventing a sentence for them would put words in a character's
// mouth on a surface a GM reads as the player's own.
const AUTO_LABOR_DESCRIPTION = "*A day's work, and nothing else.* ‡";

async function runAutoLaborPass(prisma, turn) {
  // Everyone alive, not everyone with a saved panel — the candidate set is the
  // whole roster now, which is the actual shape of "if you don't submit a move".
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      zoneId: true,
      locationId: true,
      location: { select: { id: true, name: true, attributes: true } },
    },
  });
  // An object, not null: db/index.js gates markDone on truthiness and treats
  // null as "this pass FAILED, retry next advance".
  if (characters.length === 0) {
    return { turnNumber: turn.number, filed: 0, skipped: 0, characterIds: [], dms: [] };
  }

  // Four bulk queries for the whole turn rather than four per character.
  // This decides who works and how well, and it has to scale to a full roster.
  const ids = characters.map((c) => c.id);
  const laborLocationIds = [...new Set(characters.map((c) => c.locationId).filter(Boolean))];
  const [acted, tagRows, yieldRows, config, structureRows] = await Promise.all([
    prisma.action.findMany({ where: { turnId: turn.id, characterId: { in: ids } }, select: { characterId: true } }),
    prisma.characterTag.findMany({
      where: { characterId: { in: ids } },
      // `group` is not decoration: toolsFrom reads it to tell a weapon from a
      // tool, and weapons don't stack with each other (LABORING.md §5).
      select: {
        characterId: true,
        equipped: true,
        tag: { select: { slug: true, name: true, group: true, laborBonus: true } },
      },
    }),
    prisma.locationYield.findMany({ select: { locationId: true, kind: true, current: true } }),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { productionCoefficient: true, lifewebBlood: true },
    }),
    // Structures paying into labor where anyone stands — COMPLETE only, the
    // rule buildLaborContext follows. Bulk rather than structuresAt per
    // character, the desk's own two-query-joined-in-JS shape.
    prisma.structure.findMany({
      where: { locationId: { in: laborLocationIds }, status: "COMPLETE" },
      select: { locationId: true, typeSlug: true, typeName: true },
      // structureTools breaks bonus ties by keeping the first row, so the
      // bulk read wears structuresAt's exact order or the two paths could
      // name different structures in the payout DM.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const actedIds = new Set(acted.map((a) => a.characterId));
  const coefficient = config?.productionCoefficient ?? 1;
  const lifewebFailing = (config?.lifewebBlood ?? 100) <= LIFEWEB_SPUTTER_THRESHOLD;

  const rowsByCharacter = new Map();
  for (const row of tagRows) {
    if (!rowsByCharacter.has(row.characterId)) rowsByCharacter.set(row.characterId, []);
    rowsByCharacter.get(row.characterId).push(row);
  }

  const yieldsByLocation = new Map();
  for (const row of yieldRows) {
    if (!yieldsByLocation.has(row.locationId)) yieldsByLocation.set(row.locationId, []);
    yieldsByLocation.get(row.locationId).push(row);
  }

  // Each location's structure bonuses, resolved once and shared by everyone
  // standing there — structureTools applies its per-kind non-stacking within
  // the location, and toolsFor sums the survivors onto personal tools.
  const structureTypeSlugs = [...new Set(structureRows.map((s) => s.typeSlug))];
  const structureTypes = structureTypeSlugs.length
    ? await prisma.tag.findMany({
        where: { slug: { in: structureTypeSlugs } },
        select: { slug: true, name: true, placement: true },
      })
    : [];
  const structureTypeBySlug = new Map(structureTypes.map((t) => [t.slug, t]));
  const structureRowsByLocation = new Map();
  for (const row of structureRows) {
    const type = structureTypeBySlug.get(row.typeSlug) ?? null;
    if (!structureRowsByLocation.has(row.locationId)) structureRowsByLocation.set(row.locationId, []);
    structureRowsByLocation.get(row.locationId).push({ ...row, type, placement: type ? placementOf(type) : null });
  }
  const structureToolsByLocation = new Map();
  for (const [locationId, rows] of structureRowsByLocation) {
    structureToolsByLocation.set(locationId, structureTools(rows));
  }

  // Two more bulk queries, and only when somebody is actually standing on a
  // Factory floor: which Rooms there are holding Godflesh, and who has been
  // let into them. Per-character this would be two round trips each.
  const refineryLocationIds = [
    ...new Set(characters.filter((c) => isRefinery(c.location)).map((c) => c.locationId).filter(Boolean)),
  ];
  const stashes = await loadRefineryStashes(prisma, refineryLocationIds);

  const filed = [];
  let skipped = 0;

  for (const character of characters) {
    // Acted already — including an auto-resolved travel stub, since crossing
    // zones spends the day just as surely as filing a Routine does.
    if (actedIds.has(character.id)) continue;

    const rows = rowsByCharacter.get(character.id) ?? [];
    const tagSlugs = new Set(rows.map((r) => r.tag.slug));

    // Tied to a chair, bleeding out, stunned or long gone quiet. Silent on
    // purpose: they didn't ask for this turn, and the tag is the explanation.
    if ([...tagSlugs].some((slug) => INCAPACITATING_SLUGS.has(slug))) {
      skipped += 1;
      continue;
    }

    // No Laboring tag at all: nothing is filed and nothing is sent. This is
    // the whole point of the rework — labor is a skill now, not a floor, and
    // a character without one who does nothing has simply done nothing.
    if (!canLaborAtAll({ tagSlugs })) {
      skipped += 1;
      continue;
    }

    const refinery = isRefinery(character.location);
    const ctx = {
      tagSlugs,
      tools: [
        ...toolsFrom(rows),
        ...(structureToolsByLocation.get(character.locationId) ?? []),
      ],
      yields: yieldMap(yieldsByLocation.get(character.locationId) ?? []),
      locationName: character.location?.name ?? null,
      refinery,
      refineryInput: refinery
        ? refineryInputFor(
            { characterId: character.id, locationId: character.locationId, heldSlugs: tagSlugs },
            stashes,
          )
        : null,
    };

    const rate = resolveLaborRateFrom(ctx, coefficient, { lifewebFailing });
    // Exhausted from yesterday, or standing somewhere their skills don't
    // reach. Both are states the player can see on their own sheet, and
    // filing an empty Move to say so would only clutter the GM's desk.
    if (!rate.ok) {
      skipped += 1;
      continue;
    }

    // Rolled here, not left for later: applyMoveEffects reads resourceDelta
    // only, so an unrolled expression would file the Move and pay nothing.
    const roll = rollResourceRange(rate.expression);

    try {
      const action = await prisma.$transaction(async (tx) => {
        const row = await tx.action.create({
          data: {
            characterId: character.id,
            turnId: turn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "LABOR",
            moveReviewStatus: "PASSED",
            description: AUTO_LABOR_DESCRIPTION,
            resourceDelta: roll?.value ?? null,
            resourceRollExpression: rate.expression,
            resourceRollValue: roll?.value ?? null,
            zoneId: character.zoneId ?? null,
            // Where the work happened, not where they end up — see
            // Action.locationId in schema.prisma.
            locationId: character.locationId ?? null,
            gmNotes: "auto:labor",
          },
        });
        const applied = await applyMoveEffects(tx, row);
        return tx.action.update({ where: { id: row.id }, data: { appliedEffects: applied } });
      });

      filed.push({ character, action, rate });
    } catch (err) {
      console.error(`Auto-labor for character ${character.id} failed:`, err);
    }
  }

  if (filed.length === 0) {
    return { turnNumber: turn.number, filed: 0, skipped, characterIds: [], dms: [] };
  }

  // DMs aren't sent here: each is a per-player Discord round trip, and
  // awaiting them inside resolveNeeds() would hold the Dev Panel's "End turn"
  // request open. Described here, sent by advanceTurn()'s runSideEffects()
  // after the response is already flushed.
  const dms = filed.map(({ character, action, rate }) => {
    const effects = describeMoveEffects(action.appliedEffects);
    // What actually landed decides the wording, not what the rate promised.
    const refinedRow = action.appliedEffects?.refined;
    const bonusNote = formatLaborBonusNote(rate, {
      refined: Boolean(refinedRow) && refinedRow.empty !== true,
    });
    const where = character.location?.name ? ` at ${character.location.name}` : "";
    // sendDm applies the `»` prefix to the first line itself — don't write
    // one here or it doubles up.
    const lines = [
      `*You filed nothing for turn ${turn.number}, so you worked${where}.*`,
      `» ${laborTierLabel(rate.tier)}.`,
      ...(effects ? [`**Applied:** ${effects}`] : []),
      // A refining shift pays no ⬢ and its range is a literal 0-0, so this
      // line would only ever read "+0 ⬢". A range that cannot pay is not
      // information (docs/systemdocs/FACTORY.md §4).
      ...(action.resourceRollValue != null && action.resourceRollExpression !== "0-0"
        ? [
            `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${action.resourceRollValue > 0 ? "+" : ""}${action.resourceRollValue} ⬢`,
          ]
        : []),
      // The paid range had the tools folded in silently, so without this a
      // player carrying a Longbow had no way to tell it had applied.
      ...(bonusNote ? [bonusNote] : []),
    ];
    return { discordUserId: character.discordUserId, content: lines.join("\n") };
  });

  return {
    turnNumber: turn.number,
    filed: filed.length,
    skipped,
    characterIds: filed.map(({ character }) => character.id),
    dms,
  };
}

module.exports = { runAutoLaborPass, AUTO_LABOR_DESCRIPTION };
