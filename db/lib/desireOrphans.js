// Cancels a character's ACTIVE Desires that their current tags and role no
// longer qualify them for.
//
// The hole this closes: a Desire's gate is checked when it is SET and never
// again. Strip a player's Pacifist tag, or change their role from Innkeeper to
// Peasant, and any goal that tag or role opened just sat there — still ACTIVE,
// still fulfillable for full Tag Points, because fulfillDesireRequestImpl
// checks nothing but `status: "ACTIVE"`. Nothing anywhere touched a Desire row
// when tags or roles moved.
//
// WHAT IT TOUCHES, exactly:
//   * Only `requires` — anyTags / notTags / anyRoles / notRoles. NOT a held
//     tag's desireLocks. A lock says "this isn't the kind of thing you can
//     pick any more"; it doesn't say a goal already in flight is illegitimate,
//     and Depressed is meant to be curable while the player waits.
//   * Only catalog picks (`templateId` not null). A GM's free-text Desire has
//     no gate to fail and is never touched.
//   * A GM-SET catalog pick IS cancelled if its gate later fails. Setting one
//     from /gm/dev bypasses the gate on purpose, but a GM who then strips the
//     gating tag has taken the goal away — pretending otherwise is worse.
//
// Cooldown, onceEver and "a row is already active" are all reasons a template
// isn't PICKABLE, not reasons a held Desire is illegitimate, which is why this
// calls evalRequires directly rather than evaluateDesireCatalog.
//
// Takes `tx` as a parameter and returns its DMs instead of sending them — the
// two house patterns. See db/lib/dm.js for the first and
// db/lib/tagExpiryPass.js for the second: awaiting Discord inside a
// transaction is how the Dev Panel's "End turn" used to freeze.
const { evalRequires } = require("./desireGates");

// `hiddenTagIds` is deliberately EMPTY here. That Set exists so a picker can
// withhold a row rather than name a hidden tag in a locked reason — an oracle
// defense for a UI. Cancelling isn't a UI: a gate that fails because the
// gating tag is hidden has still failed, and passing an empty Set turns
// evalRequires' `{ hidden: true }` branch into a plain `{ ok: false }`, which
// is the answer we want.
const NO_HIDDEN_TAGS = new Set();

async function cancelOrphanedDesires(tx, { characterId, openTurnNumber, actorDiscordUserId = null }) {
  const character = await tx.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      role: { select: { slug: true } },
      tags: { select: { tagId: true } },
    },
  });
  if (!character) return { cancelled: [], dms: [] };

  const active = await tx.desire.findMany({
    where: { characterId, status: "ACTIVE", NOT: { templateId: null } },
    select: {
      id: true,
      text: true,
      slotIndex: true,
      template: {
        select: {
          slug: true,
          name: true,
          requiresAnyTags: { select: { id: true, name: true } },
          requiresNotTags: { select: { id: true, name: true } },
          requiresAnyRoleSlugs: true,
          requiresNotRoleSlugs: true,
        },
      },
    },
  });
  if (active.length === 0) return { cancelled: [], dms: [] };

  const heldTagIds = new Set(character.tags.map((ct) => ct.tagId));
  const roleSlug = character.role?.slug ?? null;

  const cancelled = [];
  for (const row of active) {
    const t = row.template;
    if (!t) continue;
    // evalRequires wants roles as { slug, name }. This is the same projection
    // web/lib/desireProjection.js does, and it obeys that module's one
    // load-bearing rule: NEVER drop an unresolvable slug. desireGates.js reads
    // an empty anyRoles list as "no constraint", so filtering would silently
    // turn a role-gated Desire into an ungated one — here that would mean
    // never cancelling it. Every slug is kept, and the slug doubles as the
    // name because nothing on this path renders a reason string. That is also
    // why this doesn't import desireProjection.js: it is ESM under web/, and
    // db/lib has to stay requireable from the bot and the turn engine.
    const result = evalRequires(
      {
        requiresAnyTags: t.requiresAnyTags,
        requiresNotTags: t.requiresNotTags,
        requiresAnyRoles: t.requiresAnyRoleSlugs.map((slug) => ({ slug, name: slug })),
        requiresNotRoles: t.requiresNotRoleSlugs.map((slug) => ({ slug, name: slug })),
      },
      { heldTagIds, roleSlug, hiddenTagIds: NO_HIDDEN_TAGS }
    );
    if (result.ok) continue;
    cancelled.push({ id: row.id, name: t.name || row.text, slug: t.slug, slotIndex: row.slotIndex });
  }
  if (cancelled.length === 0) return { cancelled: [], dms: [] };

  // endedTurnNumber is stamped, not left null, so the per-slot lock and the
  // per-desire cooldown keep computing correctly — both read it, and both
  // treat a cancel exactly like a fulfil.
  await tx.desire.updateMany({
    where: { id: { in: cancelled.map((c) => c.id) } },
    data: { status: "CANCELLED", endedTurnNumber: openTurnNumber ?? null },
  });

  await tx.auditLog.createMany({
    data: cancelled.map((c) => ({
      actorDiscordUserId: actorDiscordUserId ?? "system",
      actionType: "desire_auto_cancelled",
      targetCharacterId: characterId,
      details: {
        desireSlug: c.slug,
        desireName: c.name,
        slotIndex: c.slotIndex,
        reason: "requires no longer met after a tag or role change",
      },
    })),
  });

  // ONE LINE, and deliberately WITHOUT the » prefix — same shape as
  // cavingPass.js's troubleDm/findDm. The two web-side sendDm twins prepend
  // » themselves, and the turn-advance path writes its own at the call site,
  // so a » in here would double up on one path or the other.
  const names = cancelled.map((c) => c.name).join(", ");
  const dms = character.discordUserId
    ? [
        {
          discordUserId: character.discordUserId,
          content:
            cancelled.length === 1
              ? `A goal has slipped out of reach: ${names}. You no longer meet what it asked for, so the slot is yours again next turn.`
              : `Some goals have slipped out of reach: ${names}. You no longer meet what they asked for, so those slots are yours again next turn.`,
        },
      ]
    : [];

  return { cancelled, dms };
}

// Turn-advance sweep. Runs once per advance, AFTER the expiry sweep has
// deleted the turn's expired tags — running it before would read a tag that is
// about to vanish and decide the Desire is still fine.
//
// Scoped to characters who actually hold a catalog Desire (at most
// GameConfig.desireSlots rows each, so a couple of hundred at 100+ players),
// not to the whole roster. Sequential on purpose, like every other per-player
// loop in the turn engine — never Promise.all against Postgres.
async function cancelOrphanedDesiresForEveryone(prisma, { openTurnNumber }) {
  const holders = await prisma.desire.findMany({
    where: { status: "ACTIVE", NOT: { templateId: null } },
    select: { characterId: true },
    distinct: ["characterId"],
  });

  const cancelled = [];
  const dms = [];
  for (const { characterId } of holders) {
    const result = await prisma.$transaction((tx) =>
      cancelOrphanedDesires(tx, { characterId, openTurnNumber, actorDiscordUserId: "system" })
    );
    cancelled.push(...result.cancelled);
    dms.push(...result.dms);
  }
  return { cancelled, dms };
}

module.exports = { cancelOrphanedDesires, cancelOrphanedDesiresForEveryone };
