// Per-turn tag progression, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
//
// This is the untreated-wound chain. An ordinary timed tag simply gets swept
// away when its expiresTurn comes due; a tag carrying `Tag.expiresInto` turns
// INTO something else first — Infected festers, Festering goes both Feverish
// and Necrotic, Necrosis costs you a leg or an arm. Distinct from
// consumesInto, which is the same idea driven by the player choosing to use
// something up. This one happens on the clock whether they wanted it or not,
// which is the entire reason a player goes looking for a doctor.
//
// ORDERING. This must run INSIDE resolveNeeds() immediately BEFORE the
// non-stackable expiry sweep, because that sweep is a blind deleteMany — once
// it has run there is nothing left to read. Nothing here deletes: the sweep
// that follows removes exactly the rows this pass just read, by the same
// `expiresTurn <= turn.number` predicate.
//
// NOTHING HERE KILLS ANYONE. The terminal chains all land on the `dying` tag
// and stop; a GM confirms the death through the existing path
// (web/app/(app)/gm/turns/actions.js). A turn advance that can silently end a
// player's month-long game with nobody in the loop is not a thing this
// codebase wants.
//
// Shaped for 100+ players like the Hunger pass: two reads and one bulk write
// regardless of headcount, and no network call at all — the per-player DMs are
// returned for advanceTurn()'s runSideEffects() to send later.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.

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
  // An object, not null: db/index.js reads null as "this pass failed, retry it
  // next advance" and gates markDone on truthiness. Most turns have nothing
  // expiring, so returning null here meant the pass was almost never recorded
  // as done — invisible while needsResolvedAt was stamped unconditionally, and
  // a permanently unfinished turn once it wasn't. Same fix as
  // defaultMovePass.js. hungerPass.js keeps its null, because there the pass
  // genuinely did not run and does need retrying.
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
        // A successor with no catalog duration is granted permanent, which is
        // what Dying, Missing Leg and Scarred all want. Nothing granted here
        // can fire again this pass: every duration is at least 1, and the
        // sweep matches expiresTurn <= turn.number.
        expiresTurn: successor.defaultDurationTurns
          ? turn.number + successor.defaultDurationTurns
          : null,
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

  // Not sent here — the DMs are the one network-bound part of this, and
  // awaiting them inside the turn advance is what used to freeze the Dev
  // Panel's "End turn". Handed back for runSideEffects() instead.
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
