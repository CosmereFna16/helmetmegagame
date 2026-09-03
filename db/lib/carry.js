// Carry caps, the Overburdened status and the overflow drop
// (docs/systemdocs/CARRY.md).
//
// A character carries two loads against two caps: POUNDS of gear against
// GameConfig.carryWeightLbs, and ⬢ against carryResourceCap. Both are
// multiplied by every carryMultiplier they hold. Over a cap is allowed and
// grants `overburdened`; over 1.5× it is not allowed at all, and whatever
// pushed them there is set down where they stand.
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

// Multipliers are stored ×1000 as integers so the product of several of them
// stays exact, never a float epsilon.
const MULT_SCALE = 1000;

// How far past a cap a character may go before the goods simply cannot be
// theirs. Between 1× and this they are Overburdened; past it, an acquisition
// is refused and an involuntary gain is set down on the spot.
const HARD_CAP_RATIO = 1.5;

// The category (Tag.category holds the DISPLAY name, not the YAML slug — see
// syncTags.js) whose tags never weigh on your back. A horse carries itself, a
// cart rolls, a house does not move at all.
const WEIGHTLESS_CATEGORY = "Assets";

// Does this row's carryMultiplier count right now?
//
// A vehicle has to be in your hands: an unequipped Cart is parked, and it
// hauls nothing. A trait does not — Pack Mule and Strong are bodies rather
// than gear, are not `equippable` at all, and so could never be equipped.
// Testing `equippable` rather than listing slugs keeps the rule in the
// catalog where the rest of the tag's behaviour lives.
function multiplierApplies(ct) {
  const m = ct?.tag?.carryMultiplier;
  if (!(typeof m === "number" && m > 0)) return false;
  return ct.tag.equippable ? ct.equipped === true : true;
}

// Product of every ACTIVE Tag.carryMultiplier, as a milli-multiplier (1000 =
// ×1). Per ROW, not per unit: Cart and Pack Mule are non-stackable, so a
// stack of multipliers cannot exist.
function carryMultiplier(characterTags = []) {
  let product = 1;
  for (const ct of characterTags) if (multiplierApplies(ct)) product *= ct.tag.carryMultiplier;
  return Math.round(product * MULT_SCALE);
}

// One line per active multiplier, for the hover breakdown on /character. The
// player should be able to see exactly what is holding their cap up.
function carryBreakdown(characterTags = []) {
  return characterTags.filter(multiplierApplies).map((ct) => ({
    slug: ct.tag.slug,
    name: ct.tag.name,
    multiplier: ct.tag.carryMultiplier,
  }));
}

// What one row weighs. Assets are exempt entirely; anything untradeable is
// part of you rather than cargo (a graft in your neck), and so are skills,
// injuries and statuses, which carry no weight in the catalog anyway.
function rowWeight(ct) {
  const tag = ct?.tag;
  if (!tag?.tradeable) return 0;
  if (tag.category === WEIGHTLESS_CATEGORY) return 0;
  return (tag.weightLbs ?? 0) * (ct.quantity ?? 1);
}

// What counts against the weight cap, in pounds.
function carryWeight(characterTags = []) {
  let lbs = 0;
  for (const ct of characterTags ?? []) lbs += rowWeight(ct);
  // Weights are authored to one decimal, so round the sum rather than let
  // float noise show a player "83.99999 lb".
  return Math.round(lbs * 100) / 100;
}

function carryCaps(config, milli = MULT_SCALE) {
  const weightCap = config?.carryWeightLbs ?? 120;
  const resourceCap = config?.carryResourceCap ?? 25;
  return {
    weight: Math.floor((weightCap * milli) / MULT_SCALE),
    resources: Math.floor((resourceCap * milli) / MULT_SCALE),
  };
}

// The ceiling nothing may cross, derived rather than stored so a GM raising
// the base cap moves both lines together.
function carryHardCaps(caps) {
  return {
    weight: Math.floor(caps.weight * HARD_CAP_RATIO),
    resources: Math.floor(caps.resources * HARD_CAP_RATIO),
  };
}

// The readout a sheet shows. `character` needs { tags, resources }.
function carryStatus(character, config) {
  const milli = carryMultiplier(character?.tags);
  const caps = carryCaps(config, milli);
  const hard = carryHardCaps(caps);
  const weightUsed = carryWeight(character?.tags);
  const resources = character?.resources ?? 0;
  return {
    weightUsed,
    weightCap: caps.weight,
    weightHardCap: hard.weight,
    resources,
    resourcesCap: caps.resources,
    resourcesHardCap: hard.resources,
    multiplier: milli / MULT_SCALE,
    breakdown: carryBreakdown(character?.tags),
    baseWeightCap: config?.carryWeightLbs ?? 120,
    over: weightUsed > caps.weight || resources > caps.resources,
  };
}

// The one guard every DELIBERATE acquisition asks before it writes: Transfer,
// Craft, /store, the Depot, Loot, pulling out of a room stash. An involuntary
// gain (a Labor payout, Caving loot, a GM grant) does NOT ask — it lands, and
// settleCarry sets down whatever will not fit.
//
// Returns { ok } or { ok: false, reason }, so a caller can hand the sentence
// straight to the player.
function carryAdmits(character, config, { weightLbs = 0, resources = 0 } = {}) {
  const caps = carryCaps(config, carryMultiplier(character?.tags));
  const hard = carryHardCaps(caps);
  if (weightLbs > 0) {
    const after = carryWeight(character?.tags) + weightLbs;
    if (after > hard.weight) {
      return {
        ok: false,
        reason: `That would put you at ${Math.round(after)} lb, past the ${hard.weight} lb you could carry even overburdened. Put something down first. ‡`,
      };
    }
  }
  if (resources > 0) {
    const after = (character?.resources ?? 0) + resources;
    if (after > hard.resources) {
      return {
        ok: false,
        reason: `That would put you at ${after} ⬢, past the ${hard.resources} ⬢ you could carry even overburdened. Put something down first. ‡`,
      };
    }
  }
  return { ok: true };
}

// The sentence a carry tag's description ends with, computed from the live
// config: what THIS multiplier adds on top of the base caps. Bascinet's
// wording; the ⬢ glyph replaces the word per CLAUDE.md's Resources rule.
function carryBonusLine(config, multiplier) {
  const base = carryCaps(config, MULT_SCALE);
  const raised = carryCaps(config, Math.round((multiplier ?? 1) * MULT_SCALE));
  const lbs = raised.weight - base.weight;
  const resources = raised.resources - base.resources;
  return `You can carry ${lbs} more lb, and ${resources} ⬢.`;
}

// --- Settlement ----------------------------------------------------------

const CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  discordUserId: true,
  locationId: true,
  resources: true,
  carryWeightSeen: true,
  carryResourcesSeen: true,
  age: true,
  gender: true,
  tags: {
    select: {
      id: true,
      tagId: true,
      quantity: true,
      equipped: true,
      expiresTurn: true,
      tag: {
        select: {
          id: true,
          slug: true,
          name: true,
          category: true,
          tradeable: true,
          weightLbs: true,
          equippable: true,
          carryMultiplier: true,
        },
      },
    },
  },
};

let warnedMissingTag = false;

// Draws random UNITS out of the droppable holdings until `excessLbs` pounds
// have been shed. Returns [{ tagId, tagName, quantity, expiresTurn }]
// aggregated per tag. Multiplier tags and equipped gear are never in the bag:
// dropping the Cart to fix being over would shrink the cap again and loop, and
// being disarmed by an overfull pack reads badly.
//
// A weightless unit can never help, so it is not even a candidate — otherwise
// the shuffle would spend draws on letters while the anvil stayed put.
function drawDrops(characterTags, excessLbs) {
  const units = [];
  for (const ct of characterTags) {
    if (!ct.tag.tradeable || ct.equipped || ct.tag.carryMultiplier) continue;
    const each = rowWeight({ ...ct, quantity: 1 });
    if (each <= 0) continue;
    for (let i = 0; i < (ct.quantity ?? 1); i += 1) units.push(ct);
  }
  // Fisher–Yates, then take from the front until the excess is covered.
  for (let i = units.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  const chosen = [];
  let shed = 0;
  for (const ct of units) {
    if (shed >= excessLbs) break;
    chosen.push(ct);
    shed += rowWeight({ ...ct, quantity: 1 });
  }
  const taken = new Map();
  for (const ct of chosen) {
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

// The holdings as they stand after a drop manifest is applied, so the load can
// be recomputed without a second read inside the transaction.
function applyDrops(characterTags, taken) {
  const byTag = new Map(taken.map((t) => [t.tagId, t.quantity]));
  return characterTags
    .map((ct) => {
      const gone = byTag.get(ct.tagId) ?? 0;
      if (!gone) return ct;
      return { ...ct, quantity: Math.max(0, (ct.quantity ?? 1) - gone) };
    })
    .filter((ct) => (ct.quantity ?? 1) > 0);
}

// Recomputes one character's load against their caps and makes the sheet
// agree with it: grants or clears `overburdened`, and — when they are past the
// HARD cap (1.5×, carryAdmits above) — sets the excess down in a random public
// room at their Location.
//
// The drop is acquisition-driven, never capacity-driven, and
// Character.carryWeightSeen / carryResourcesSeen are what tell the two apart:
// a load that has not GROWN since the last settle sheds nothing, however far
// the cap may have fallen beneath it. So unequipping a cart at an inn door, or
// a GM lowering the base cap, makes people Overburdened and no more. Only
// goods that arrived without asking — a Labor payout, Caving loot, a GM grant
// — can push someone past the ceiling, and only those get set down.
// Deliberate acquisitions are refused by carryAdmits() before they land.
//
// Returns null when there was nothing to do; otherwise
// { characterId, over, granted, removed, drop } where `drop` carries the
// Discord work for deliverCarryDrop(). Nothing here talks to Discord: web
// callers deliver in after(), the turn pass hands the drops to runSideEffects.
//
// With nowhere to put anything down (unplaced, or a Location with no public
// room) the character simply stays over the ceiling and the next settle — on
// arrival, or at turn close — retries for free. `{ drop: false }` settles the
// status without ever shedding, which is what the sync's rebase wants.
async function settleCarry(prisma, characterId, { drop = true } = {}) {
  if (!characterId) return null;
  return prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { id: characterId }, select: CHARACTER_SELECT });
    if (!character || character.status !== "ALIVE") return null;
    const config = await tx.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryWeightLbs: true, carryResourceCap: true },
    });

    const caps = carryCaps(config, carryMultiplier(character.tags));
    const hard = carryHardCaps(caps);
    let load = carryWeight(character.tags);
    let resources = character.resources;
    let over = load > caps.weight || resources > caps.resources;

    // The watermark is the whole of what distinguishes an ACQUISITION from a
    // capacity SHRINK. A load that has not grown since the last settle sheds
    // nothing, however far over the ceiling the cap has fallen beneath it —
    // which is what lets a cart be parked at an inn door without emptying it.
    const seenWeight = character.carryWeightSeen ?? 0;
    const seenResources = character.carryResourcesSeen ?? 0;
    const weightGrew = load > seenWeight;
    const resourcesGrew = resources > seenResources;

    let dropResult = null;
    let deferred = false;

    if (drop && ((load > hard.weight && weightGrew) || (resources > hard.resources && resourcesGrew))) {
      const room = await pickRandomPublicRoom(tx, character.locationId);
      if (!room) {
        // Nowhere to put it down — unplaced, or a Location with no public
        // room. Hold the watermark back so the growth is still unclaimed and
        // the next settle (on arrival, or at turn close) retries for free.
        // Advancing it here would mark the load "seen" and the shed would
        // never happen at all.
        deferred = true;
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: "carry_drop_deferred",
            targetCharacterId: character.id,
            details: { load, resources, caps, hard, seenWeight, seenResources, locationId: character.locationId },
          },
        });
      } else {
        // Shed back to the ORDINARY cap, not to the ceiling. Landing a
        // character exactly on 1.5× would leave them permanently one letter
        // away from spilling again, and re-dropping every turn.
        const tags = load > hard.weight && weightGrew ? drawDrops(character.tags, load - caps.weight) : [];
        for (const t of tags) {
          await dropCharacterTag(tx, character.id, t.tagId, t.quantity);
          await addToRoomStack(tx, room.id, t.tagId, t.quantity, { expiresTurn: t.expiresTurn });
        }
        if (tags.length) load = carryWeight(applyDrops(character.tags, tags));

        const spill = resources > hard.resources && resourcesGrew ? resources - caps.resources : 0;
        if (spill > 0) {
          await moveParty(tx, { kind: "character", id: character.id, name: character.name }, -spill);
          await moveParty(tx, { kind: "room", id: room.id, name: room.name }, spill);
          resources -= spill;
        }
        over = load > caps.weight || resources > caps.resources;

        const manifest = tags.map(({ tagId, tagName, quantity }) => ({ tagId, tagName, quantity }));
        if (manifest.length || spill > 0) {
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
    }

    // Advance the watermark to what they are actually carrying now — after any
    // shed, so a shed load is what the next settle compares against. The
    // conditional WHERE is the claim: two settles racing on the same growth
    // must not both shed, and the loser simply sees no growth next time.
    if (!deferred && (load !== seenWeight || resources !== seenResources)) {
      await tx.character.updateMany({
        where: { id: character.id, carryWeightSeen: seenWeight, carryResourcesSeen: seenResources },
        data: { carryWeightSeen: load, carryResourcesSeen: resources },
      });
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
  HARD_CAP_RATIO,
  carryMultiplier,
  carryBreakdown,
  carryWeight,
  rowWeight,
  carryCaps,
  carryHardCaps,
  carryStatus,
  carryAdmits,
  carryBonusLine,
  settleCarry,
  deliverCarryDrop,
};
