// Per-turn tag progression, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
//
// This is the untreated-wound chain: a tag carrying `Tag.expiresInto` turns
// INTO something else instead of just being swept (Infected → Festering →
// Feverish/Necrotic, etc). MUST run immediately BEFORE the non-stackable
// expiry sweep — that sweep is a blind deleteMany, so it deletes the rows
// this pass just read. Only ever grants; db/lib/dyingDeathPass.js kills.
// Takes `prisma` as a parameter — see db/lib/dm.js for why.

const { expiryFrom } = require("./turnFormat");

// Stackable tags are deliberately out of scope. A stack doesn't expire, it
// SHEDS (sweepExpiredStacks in db/index.js), so "what does it turn into" has
// no single answer — and nothing stackable is an affliction anyway.
async function runTagExpiryPass(prisma, turn) {
  const expiring = await prisma.characterTag.findMany({
    where: {
      expiresTurn: { lte: turn.number },
      tag: { stackable: false, NOT: { expiresInto: { equals: null } } },
    },
    select: {
      characterId: true,
      character: { select: { status: true, discordUserId: true } },
      tag: { select: { slug: true, name: true, expiresInto: true } },
    },
  });
  // An object, not null: db/index.js reads null as "this pass failed, retry
  // it next advance" and gates markDone on truthiness. hungerPass.js keeps
  // its null, because there the pass genuinely did not run and needs retrying.
  if (expiring.length === 0) return { turnNumber: turn.number, progressed: 0, dms: [] };

  // Only the successors actually named, rather than the whole catalog.
  const successorSlugs = new Set();
  for (const ct of expiring) {
    for (const entry of ct.tag.expiresInto ?? []) {
      for (const slug of entry?.oneOf ?? []) successorSlugs.add(slug);
    }
  }
  const successors = await prisma.tag.findMany({
    where: { slug: { in: [...successorSlugs] } },
    select: { id: true, slug: true, name: true, defaultDurationTurns: true },
  });
  const successorBySlug = new Map(successors.map((t) => [t.slug, t]));

  const rows = [];
  // characterId -> { discordUserId, lines: ["Infected → Festering", ...] }
  const progressions = new Map();
  const missing = new Set();

  for (const ct of expiring) {
    // A dead character's sheet stops moving. Their rows still get swept by
    // the deleteMany that follows; they just don't progress into anything.
    if (ct.character?.status !== "ALIVE") continue;

    const gained = [];
    for (const entry of ct.tag.expiresInto ?? []) {
      const choices = entry?.oneOf ?? [];
      if (choices.length === 0) continue;
      // An even pick. A bare slug in the YAML normalises to a one-element
      // oneOf (db/lib/syncTags.js), so this is the only branch there is.
      const slug = choices[Math.floor(Math.random() * choices.length)];
      const successor = successorBySlug.get(slug);
      if (!successor) {
        // Catalog out of step with the YAML. Say so once per slug rather than
        // once per character, and carry on with the rest of the progression.
        missing.add(slug);
        continue;
      }
      rows.push({
        characterId: ct.characterId,
        tagId: successor.id,
        source: "EVENT",
        // Same absolute-turn expression as the Hunger pass and
        // sweepExpiredStacks, so all three writers derive expiry identically.
        // A successor with no catalog duration is granted permanent (Missing
        // Leg, Scarred). Nothing granted here can fire again this pass: every
        // duration is at least 1, and both the sweep and dyingDeathPass match
        // expiresTurn <= turn.number.
        expiresTurn: expiryFrom(turn.number + 1, successor.defaultDurationTurns),
      });
      gained.push(successor.name);
    }

    if (gained.length === 0) continue;
    if (!progressions.has(ct.characterId)) {
      progressions.set(ct.characterId, { discordUserId: ct.character.discordUserId, lines: [] });
    }
    progressions.get(ct.characterId).lines.push(`${ct.tag.name} → ${gained.join(" and ")}`);
  }

  for (const slug of missing) {
    console.error(`Tag expiry pass: no "${slug}" tag — run npm run db:sync-tags.`);
  }

  // skipDuplicates is the "already holds it" rule, not just a safety net:
  // a character already carrying the successor keeps THEIR row, with its own
  // clock, exactly as consumesInto leaves an already-held grant alone
  // (docs/systemdocs/TAGS.md §5b). Re-granting would silently reset the timer
  // on a condition they were already most of the way through.
  await prisma.characterTag.createMany({ data: rows, skipDuplicates: true });

  // Not sent here — DMs are the one network-bound part of this, and awaiting
  // them inside the turn advance would freeze the Dev Panel's "End turn".
  const dms = [...progressions.values()]
    .filter((p) => p.discordUserId)
    .map((p) => ({
      discordUserId: p.discordUserId,
      // Bot-composed, so the » goes in at the call site rather than coming
      // from sendDm — see CLAUDE.md's aura note.
      content: ["Something has taken a turn for the worse.", ...p.lines.map((l) => `» ${l}`)].join("\n"),
    }));

  return {
    turnNumber: turn.number,
    progressed: progressions.size,
    granted: rows.length,
    unknownSlugs: [...missing],
    dms,
  };
}

module.exports = { runTagExpiryPass };
