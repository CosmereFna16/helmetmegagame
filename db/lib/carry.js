// Carry caps, the Overburdened status and the overflow drop
// (docs/systemdocs/CARRY.md).
//
// The pure half at the top has no prisma and no I/O, so a client component
// can import it for a "7 / 10 items" readout without dragging the barrel
// into the browser bundle (ARCHITECTURE.md §2). settleCarry below is the
// stateful half: pull-based and post-commit, the same posture as
// roomAccess.js#syncCharacterRoomAccess, because the writers that change what
// a character holds are many and scattered (ten of them bypass tagWrites.js
// with raw deleteMany) and a push from any one of them would miss the rest.
//
// Takes `prisma` as a parameter and stays OFF the @lifeweb/db barrel —
// db/index.js's turn engine imports this, so requiring the barrel back would
// resolve to a partial exports object. Require it by path.
const { OVERBURDENED_SLUG } = require("./constants");
const { addToStack, dropCharacterTag, addToRoomStack } = require("./tagWrites");
const { moveParty } = require("./resourceTransfer");
const { pickRandomPublicRoom, formatManifest } = require("./roomStash");
const { announceInRoom } = require("./roomAnnounce");
const { sendDm } = require("./dm");

// Multipliers are stored ×1000 as integers (Character.carryMultiplierSeen)
// so "has it shrunk?" is an exact comparison, never a float epsilon.
const MULT_SCALE = 1000;

// Product of every held Tag.carryMultiplier, as a milli-multiplier (1000 =
// ×1). Per ROW, not per unit: Cart and Pack Mule are non-stackable, so a
// stack of multipliers cannot exist.
function carryMultiplier(characterTags = []) {
  let product = 1;
  for (const ct of characterTags) {
    const m = ct?.tag?.carryMultiplier;
    if (typeof m === "number" && m > 0) product *= m;
  }
  return Math.round(product * MULT_SCALE);
}

// What counts against the tag cap: every UNIT of every tradeable tag. Skills,
// injuries, statuses and untradeable items (a graft in your neck) are part
// of you, not cargo.
function carryLoad(characterTags = []) {
  let n = 0;
  for (const ct of characterTags) if (ct?.tag?.tradeable) n += ct.quantity ?? 1;
  return n;
}

function carryCaps(config, milli = MULT_SCALE) {
  const tagCap = config?.carryTagCap ?? 10;
  const resourceCap = config?.carryResourceCap ?? 25;
  return {
    tags: Math.floor((tagCap * milli) / MULT_SCALE),
    resources: Math.floor((resourceCap * milli) / MULT_SCALE),
  };
}

// The readout a sheet shows. `character` needs { tags, resources }.
function carryStatus(character, config) {
  const milli = carryMultiplier(character?.tags);
  const caps = carryCaps(config, milli);
  const tagsUsed = carryLoad(character?.tags);
  const resources = character?.resources ?? 0;
  return {
    tagsUsed,
    tagsCap: caps.tags,
    resources,
    resourcesCap: caps.resources,
    multiplier: milli / MULT_SCALE,
    over: tagsUsed > caps.tags || resources > caps.resources,
  };
}

// The sentence a carry tag's description ends with, computed from the live
// config: what THIS multiplier adds on top of the base caps. Bascinet's
// wording; the ⬢ glyph replaces the word per CLAUDE.md's Resources rule.
function carryBonusLine(config, multiplier) {
  const base = carryCaps(config, MULT_SCALE);
  const raised = carryCaps(config, Math.round((multiplier ?? 1) * MULT_SCALE));
  const tags = raised.tags - base.tags;
  const resources = raised.resources - base.resources;
  return `You can carry ${tags} more item ${tags === 1 ? "tag" : "tags"}, and ${resources} ⬢.`;
}

// --- Settlement ----------------------------------------------------------

const CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  discordUserId: true,
  locationId: true,
  resources: true,
  carryMultiplierSeen: true,
  age: true,
  gender: true,
  tags: {
    select: {
      id: true,
      tagId: true,
      quantity: true,
      equipped: true,
      expiresTurn: true,
      tag: { select: { id: true, slug: true, name: true, tradeable: true, carryMultiplier: true } },
    },
  },
};

let warnedMissingTag = false;

// Draws random UNITS out of the droppable holdings until the load fits the
// cap. Returns [{ tagId, tagName, quantity, expiresTurn }] aggregated per
// tag. Multiplier tags and equipped gear are never in the bag: dropping the
// Cart to fix losing the Pack Mule would shrink the cap again and loop, and
// being disarmed by a lost cart reads badly.
function drawDrops(characterTags, excess) {
  const units = [];
  for (const ct of characterTags) {
    if (!ct.tag.tradeable || ct.equipped || ct.tag.carryMultiplier) continue;
    for (let i = 0; i < (ct.quantity ?? 1); i += 1) units.push(ct);
  }
  // Fisher–Yates, then take the first `excess`.
  for (let i = units.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  const taken = new Map();
  for (const ct of units.slice(0, Math.max(0, excess))) {
    const entry = taken.get(ct.tagId) ?? {
      tagId: ct.tagId,
      tagName: ct.tag.name,
      quantity: 0,
      expiresTurn: ct.expiresTurn,
    };
    entry.quantity += 1;
    taken.set(ct.tagId, entry);
  }
  return [...taken.values()];
}

// Recomputes one character's load against their caps and makes the sheet
// agree with it: grants or clears `overburdened`, and — when the multiplier
// product has SHRUNK since the last settle (a Cart or Pack Mule just left)
// and they are over — drops the excess into a random public room at their
// Location.
//
// Returns null when there was nothing to do or a concurrent settle already
// claimed the shrink; otherwise { characterId, over, granted, removed, drop }
// where `drop` carries the Discord work for deliverCarryDrop(). Nothing here
// talks to Discord: web callers deliver in after(), the turn pass hands the
// drops to runSideEffects.
//
// `seen` only advances past a shrink once the drop has actually landed. With
// nowhere to drop (unplaced, or a Location with no public room) it is left
// alone, so the next settle — on arrival, or at turn close — retries for
// free. `{ drop: false }` is the rebase used after a catalog edit changes a
// multiplier: advance `seen`, grant the status, never drop.
async function settleCarry(prisma, characterId, { drop = true } = {}) {
  if (!characterId) return null;
  return prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { id: characterId }, select: CHARACTER_SELECT });
    if (!character || character.status !== "ALIVE") return null;
    const config = await tx.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryTagCap: true, carryResourceCap: true },
    });

    const now = carryMultiplier(character.tags);
    const seen = character.carryMultiplierSeen ?? MULT_SCALE;
    const caps = carryCaps(config, now);
    let load = carryLoad(character.tags);
    let resources = character.resources;
    let over = load > caps.tags || resources > caps.resources;

    let dropResult = null;
    let advanceSeen = now !== seen;

    if (drop && now < seen && over) {
      const room = await pickRandomPublicRoom(tx, character.locationId);
      if (!room) {
        // Nowhere to put it down. Keep `seen` high so the shrink is retried
        // at the next settle, and say so in the log.
        advanceSeen = false;
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: "carry_drop_deferred",
            targetCharacterId: character.id,
            details: { load, resources, caps, locationId: character.locationId },
          },
        });
      } else {
        // The claim: two settles racing on the same shrink must not both
        // drop. Same conditional-updateMany idiom as stagedPush.js#appliedAt.
        const claimed = await tx.character.updateMany({
          where: { id: character.id, carryMultiplierSeen: seen },
          data: { carryMultiplierSeen: now },
        });
        if (claimed.count === 0) return null;
        advanceSeen = false;

        const tags = drawDrops(character.tags, load - caps.tags);
        for (const t of tags) {
          await dropCharacterTag(tx, character.id, t.tagId, t.quantity);
          await addToRoomStack(tx, room.id, t.tagId, t.quantity, { expiresTurn: t.expiresTurn });
          load -= t.quantity;
        }
        const spill = Math.max(0, resources - caps.resources);
        if (spill > 0) {
          await moveParty(tx, { kind: "character", id: character.id, name: character.name }, -spill);
          await moveParty(tx, { kind: "room", id: room.id, name: room.name }, spill);
          resources -= spill;
        }
        over = load > caps.tags || resources > caps.resources;

        const manifest = tags.map(({ tagId, tagName, quantity }) => ({ tagId, tagName, quantity }));
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: "carry_overflow_dropped",
            targetCharacterId: character.id,
            details: { roomId: room.id, roomName: room.name, tags: manifest, resources: spill },
          },
        });
        dropResult = {
          room,
          tags: manifest,
          resources: spill,
          character: {
            id: character.id,
            name: character.name,
            discordUserId: character.discordUserId,
            age: character.age,
            gender: character.gender,
          },
        };
      }
    }

    if (advanceSeen) {
      await tx.character.update({ where: { id: character.id }, data: { carryMultiplierSeen: now } });
    }

    // The status tag follows the cap; a player never removes it themselves.
    const held = character.tags.find((ct) => ct.tag.slug === OVERBURDENED_SLUG);
    let granted = false;
    let removed = false;
    if (over && !held) {
      const tag = await tx.tag.findUnique({ where: { slug: OVERBURDENED_SLUG }, select: { id: true } });
      if (tag) {
        await addToStack(tx, character.id, tag.id, 1, { source: "EVENT" });
        granted = true;
      } else if (!warnedMissingTag) {
        warnedMissingTag = true;
        console.error(`settleCarry: no "${OVERBURDENED_SLUG}" tag — run npm run db:sync-tags. Carry caps won't bite.`);
      }
    } else if (!over && held) {
      await dropCharacterTag(tx, character.id, held.tagId);
      removed = true;
    }

    if (!granted && !removed && !dropResult) return null;
    return { characterId: character.id, over, granted, removed, drop: dropResult };
  });
}

// The Discord half of a drop: a DM to the character and an aliased line in
// the room. Run after the settle's transaction has committed.
async function deliverCarryDrop(prisma, result) {
  const drop = result?.drop;
  if (!drop) return;
  const goods = formatManifest(drop.tags, drop.resources);
  if (drop.character.discordUserId) {
    await sendDm(
      prisma,
      drop.character.discordUserId,
      `You can't carry it all any more. You leave ${goods} in ${drop.room.name}. ‡`,
    ).catch((err) => console.error(`Carry drop DM to ${drop.character.discordUserId} failed:`, err.message));
  }
  await announceInRoom(drop.room, drop.character, "sets down more than they could carry.", [goods]);
}

module.exports = {
  MULT_SCALE,
  carryMultiplier,
  carryLoad,
  carryCaps,
  carryStatus,
  carryBonusLine,
  settleCarry,
  deliverCarryDrop,
};
