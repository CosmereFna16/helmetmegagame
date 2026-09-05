"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { prisma } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { isSuperadmin } from "@/lib/superadmin";
import { getGmSession, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { applyTagOpsInTx } from "@/lib/characterWrite";
import {
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
} from "@lifeweb/db/lib/tagShapes";
import { TURNS_PATH } from "@/lib/routes";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId || !gm) throw new UserError("Not authorized.");
  return session;
}

// A GM-authored tag's slug is generated here and never typed.
//
// If a GM could pick the slug, naming a tag "Arthritis" would collide with
// the one in docs/tags.yaml and the next `npm run db:sync-tags` would upsert
// straight over their row — silently converting their homebrew into a YAML
// tag and clobbering every field. The prefix also guarantees a custom slug
// can never appear in db:prune-tags' YAML slug set by accident.
function customSlug(name) {
  const base = (name ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!base) throw new UserError("That name doesn't produce a usable slug.");
  return `custom-${base}`;
}

// A nullable, non-negative whole number out of a form field, where an empty
// box means "not set" rather than zero — the shape every optional number on
// the tag form takes.
function optionalCount(raw, label) {
  if (raw === "" || raw == null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new UserError(`${label} must be a whole number of at least 0, or blank.`);
  }
  return n;
}

// A nullable armour value out of a form field: 0 to 1, decimals allowed, an
// empty box meaning "turns nothing aside". Separate from optionalCount because
// this is the only fractional field on the form, and parseInt would silently
// read 0.35 as 0 — which is the worst possible way for armour to fail.
function optionalArmor(raw, label) {
  if (raw === "" || raw == null) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new UserError(`${label} must be between 0 and 1, or blank.`);
  }
  return n;
}

// The subset of Tag a GM may set from the UI. Everything absent from this
// list — parentTagId, requiredTagId, exclusive, depotPrice, consumesInto — is
// catalog structure that belongs in docs/tags.yaml, where it can be reviewed
// and version-controlled alongside the tags it wires together.
//
// Two fields the form DOES carry are handled outside this function, because
// neither is a scalar: expiresInto needs every other tag's slug to validate
// against, and requirementSkills is a Prisma relation. See relationsFrom.
function scalarsFrom(input) {
  const name = (input.name ?? "").toString().trim();
  if (!name) throw new UserError("A tag needs a name.");
  if (name.length > 60) throw new UserError("Keep the name under 60 characters.");

  const category = (input.category ?? "").toString().trim();
  if (!category) throw new UserError("Pick a category.");

  const pointCost = Number.parseInt(input.pointCost, 10);
  const duration = input.defaultDurationTurns === "" || input.defaultDurationTurns == null
    ? null
    : Number.parseInt(input.defaultDurationTurns, 10);
  if (duration != null && (!Number.isInteger(duration) || duration < 1)) {
    throw new UserError("A duration is a whole number of turns, or blank for permanent.");
  }

  const equippable = Boolean(input.equippable);
  // The same invariant syncTags.js enforces on the YAML: concealing identity
  // is a property of something worn, so it means nothing without equippable.
  if (input.concealsIdentity && !equippable) {
    throw new UserError("Only an equippable tag can conceal identity.");
  }
  // A concealing tag also needs a Tag.concealSprite — the face the room sees
  // instead of the wearer's — and this form has no editor for one, because the
  // image has to exist as a real file under web/public/assets/helms (built by
  // `npm run assets:helms`). A GM can't add one at runtime. Without the sprite
  // the flag would simply do nothing, which is the quiet failure the throw in
  // syncTags.js exists to prevent; refusing here says so out loud instead.
  if (input.concealsIdentity) {
    throw new UserError(
      "Concealing gear needs a sprite, so it has to be authored in docs/tags.yaml rather than here. ‡",
    );
  }

  // Three states, not a checkbox (Tag.inspectVisibility). A missing or unknown
  // value reads as HIDDEN, which is the safe direction for a vision gate.
  const inspectVisibility = ["HIDDEN", "ALWAYS", "WORN"].includes(input.inspectVisibility)
    ? input.inspectVisibility
    : "HIDDEN";
  // Same pairing as concealsIdentity above, and as syncTags.js enforces on the
  // YAML: a tag nobody can equip could never be seen under a worn-only rule.
  if (inspectVisibility === "WORN" && !equippable) {
    throw new UserError("Only an equippable tag can be seen just while it's worn.");
  }

  const sellable = Boolean(input.sellable);
  const sellablePrice = input.sellablePrice === "" || input.sellablePrice == null
    ? null
    : Number.parseInt(input.sellablePrice, 10);
  // Same pairing invariant syncTags.js enforces on docs/tags.yaml
  // (sellable/sellablePrice travel together, DEPOT.md §4) — a typo on one
  // side would either buy nothing off a player or silently never offer a
  // sale.
  if (sellable && !(Number.isInteger(sellablePrice) && sellablePrice > 0)) {
    throw new UserError("A sellable tag needs a positive sellable price.");
  }
  if (sellablePrice != null && !sellable) {
    throw new UserError("Check Sellable before setting a sellable price.");
  }

  return {
    name,
    description: (input.description ?? "").toString().trim() || null,
    category,
    pointCost: Number.isInteger(pointCost) ? pointCost : 0,
    groupId: (input.groupId ?? "").toString().trim() || null,
    inspectVisibility,
    stackable: Boolean(input.stackable),
    equippable,
    consumable: Boolean(input.consumable),
    removable: Boolean(input.removable),
    tradeable: Boolean(input.tradeable),
    healable: Boolean(input.healable),
    teachable: Boolean(input.teachable),
    purchasable: Boolean(input.purchasable),
    purchasableAfterStart: Boolean(input.purchasableAfterStart),
    sellable,
    sellablePrice,
    defaultDurationTurns: duration,
    // This used to be validated above and then quietly dropped here, so a GM
    // could tick "conceals identity", pass the check, and get a tag with the
    // column still false. The check was real; the write was missing.
    concealsIdentity: Boolean(input.concealsIdentity),
    // What it costs to shed the tag. Mostly an adjudication reference, with
    // one exception that makes it worth authoring: HEAL_CHARACTER enforces
    // requirementResources and requirementSkills on a Status tag (TAGS.md
    // §5c), so a custom affliction without them is curable for free.
    requirementTurns: optionalCount(input.requirementTurns, "Requirement turns"),
    requirementResources: optionalCount(input.requirementResources, "Requirement resources"),
    requirementGambit: Boolean(input.requirementGambit),
    // Armour, as a fraction of a blow turned aside. Players never see these
    // numbers — db/lib/armorValue.js turns them into a word — but a GM tuning
    // a piece of gear needs the number itself, so the form takes it raw.
    meleeArmor: optionalArmor(input.meleeArmor, "Melee armour"),
    ballisticArmor: optionalArmor(input.ballisticArmor, "Ballistic armour"),
  };
}

// The two fields that can't be scalars, resolved against the live catalog.
//
// expiresInto is stored as normalized JSON and validated by the same pair
// db:sync-tags uses (db/lib/tagShapes.js), so the form cannot accept a chain
// the YAML sync would reject. requirementSkills is a many-to-many self
// relation, so this returns the validated id list and each call site builds
// its own nested write — `connect` on create, `set` on update. They are not
// interchangeable: Prisma rejects `set` inside a create, and `connect` on an
// update would only ever add, so emptying the picker would silently keep the
// old skills attached.
async function relationsFrom(input, { selfId, selfSlug, durationTurns }) {
  const catalog = await prisma.tag.findMany({ select: { id: true, slug: true } });
  const knownSlugs = new Set(catalog.map((t) => t.slug));
  const knownIds = new Set(catalog.map((t) => t.id));

  let expiresInto = null;
  try {
    expiresInto = normalizeExpiresInto(input.expiresInto, "This tag");
    // An outcome row the GM added but never picked a tag for would be an
    // empty oneOf, which tagExpiryPass would roll over nothing. Drop them
    // rather than refusing — an empty row is an unfinished thought, not an
    // error, and the sync's own shape check would reject it.
    expiresInto = expiresInto?.filter((row) => row.oneOf.length > 0) ?? null;
    if (expiresInto?.length === 0) expiresInto = null;
    validateExpiresInto(expiresInto, {
      selfSlug,
      knownSlugs,
      durationTurns,
      label: "This tag",
    });
  } catch (err) {
    // tagShapes throws plain Errors, since its other caller is a CLI script.
    // On this side they are a GM's form mistake, so they have to arrive as a
    // UserError for guarded() to render them in the dialog.
    throw new UserError(err.message);
  }

  // removesInto — the treated-wound aftermath — same shared pair, same
  // empty-row tolerance, minus the duration requirement.
  let removesInto = null;
  try {
    removesInto = normalizeRemovesInto(input.removesInto, "This tag");
    removesInto = removesInto?.filter((row) => row.oneOf.length > 0) ?? null;
    if (removesInto?.length === 0) removesInto = null;
    validateRemovesInto(removesInto, { selfSlug, knownSlugs, label: "This tag" });
  } catch (err) {
    throw new UserError(err.message);
  }

  const skillTagIds = [...new Set((input.skillTagIds ?? []).filter(Boolean))];
  for (const id of skillTagIds) {
    if (!knownIds.has(id)) throw new UserError("One of those skill tags no longer exists.");
    if (id === selfId) throw new UserError("A tag can't be its own cure requirement.");
  }

  return { expiresInto, removesInto, skillTagIds };
}

// The custom-tag dialog's door on every desk — see
// web/app/components/CustomTagDialog.js and DEV-PANEL.md §8. The tag is
// created in its own small transaction, then granted or staged against
// whichever targets the door preselected ONE TRANSACTION PER CHARACTER, then
// one audit row for the whole gesture — bulkTagCharacters' convention
// ((app)/gm/actions.js). Everything that can refuse (no open turn to stage
// against, too many targets) is checked before the tag row exists, so a
// refusal never leaves an orphan the GM can't recreate under the same name.
//
// `stage` writes a StagedEffect per target instead of a live grant, built the
// same way createStagedEffects does ((desk)/gm/turns/actions.js) — one
// tagOps-add payload, one shared batchId across a multi-target batch — copied
// rather than imported, since that file is itself "use server" and a
// multi-target grant here is a GM-toolkit convenience action, not the
// adjudication desk's own staging flow.
async function createCustomTagAndAssignImpl({ assignCharacterIds, stage, ...input }) {
  const session = await requireGm();
  const data = scalarsFrom(input);
  const slug = customSlug(data.name);
  // Validated before the tag row exists, like everything else that can refuse
  // below — a bad expiry chain must not leave an orphan behind.
  const { expiresInto, removesInto, skillTagIds } = await relationsFrom(input, {
    selfId: null,
    selfSlug: slug,
    durationTurns: data.defaultDurationTurns,
  });
  const targets = [...new Set((assignCharacterIds ?? []).filter(Boolean))];
  // Same cap as bulkTagCharacters (web/app/(app)/gm/actions.js).
  if (targets.length > 200) throw new UserError("Pick at most 200 characters at once.");

  // Refuse BEFORE the tag exists: a thrown UserError after the create would
  // leave a committed row behind, and every retry would then hit the clash
  // check below with no way out short of a rename.
  const openTurn = targets.length ? await prisma.turn.findFirst({ where: { status: "OPEN" } }) : null;
  if (stage && targets.length && !openTurn) throw new UserError("No turn is open to stage against.");

  // The tag itself: one small transaction.
  const tag = await prisma.$transaction(async (tx) => {
    const clash = await tx.tag.findFirst({
      where: { OR: [{ slug }, { name: data.name }] },
      select: { name: true },
    });
    if (clash) throw new UserError(`A tag called "${clash.name}" already exists.`);
    return tx.tag.create({
      data: {
        ...data,
        slug,
        custom: true,
        expiresInto,
        removesInto,
        // `connect`, not `set` — Prisma rejects `set` inside a create.
        requirementSkills: { connect: skillTagIds.map((id) => ({ id })) },
      },
    });
  });

  // The grants: ONE TRANSACTION PER CHARACTER, never one across the batch —
  // the rule bulkTagCharacters states, and for the same reasons: a wide
  // transaction holds a row lock against every target's own equip toggles for
  // its whole duration, and one bad character would roll back the rest.
  // Living targets only: a dead sheet gets neither a live grant nor a staged
  // one the push would apply to a corpse.
  let batchId = null;
  const applied = [];
  const failed = [];
  const living = targets.length
    ? new Set(
        (await prisma.character.findMany({ where: { id: { in: targets }, status: "ALIVE" }, select: { id: true } })).map(
          (c) => c.id,
        ),
      )
    : new Set();
  for (const id of targets) if (!living.has(id)) failed.push({ characterId: id, error: "No living character." });
  const liveTargets = targets.filter((id) => living.has(id));

  if (liveTargets.length) {
    if (stage) {
      batchId = liveTargets.length > 1 ? crypto.randomUUID() : null;
      const payload = { tagOps: [{ tagId: tag.id, op: "add", quantity: 1 }] };
      await prisma.stagedEffect.createMany({
        data: liveTargets.map((targetCharacterId) => ({
          turnId: openTurn.id,
          targetCharacterId,
          createdByDiscordUserId: session.discordUserId,
          batchId,
          payload,
        })),
      });
      applied.push(...liveTargets);
    } else {
      const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } });
      const tagsById = new Map([[tag.id, tag]]);
      for (const characterId of liveTargets) {
        try {
          await prisma.$transaction((tx) =>
            applyTagOpsInTx(tx, {
              characterId,
              ops: [{ tagId: tag.id, op: "add", quantity: 1 }],
              tagsById,
              openTurn,
              equipSlots: config?.equipSlots ?? 6,
            }),
          );
          applied.push(characterId);
        } catch (err) {
          failed.push({ characterId, error: err?.message ?? "Failed." });
        }
      }
    }
  }

  const staged = Boolean(stage && applied.length);
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_custom_tag_created",
      details: { tagId: tag.id, slug, name: tag.name, characterIds: applied, failed, staged, batchId },
    },
  });

  const result = { tagId: tag.id, name: tag.name, slug, applied: applied.length, failed, staged };

  revalidatePath("/gm/dev/tags");
  revalidatePath("/character");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/players", "layout");

  // A live grant may change narrowcast access (#cerberon) and
  // private-room membership, same as bulkTagCharacters. Sequential and after
  // the writes, per ARCHITECTURE.md §5 — never a fan-out of REST calls at
  // Discord's rate limiter. A staged grant hasn't touched anyone's holdings
  // yet, so it's skipped here.
  if (applied.length && !result.staged) {
    after(() => afterInventoryChange(applied));
  }

  return result;
}

// Editing is refused for a YAML-sourced tag rather than merely discouraged:
// the next sync would silently revert it, so allowing the edit would be a
// lie. docs/tags.yaml is the place to change those.
async function updateCustomTagImpl({ tagId, ...input }) {
  const session = await requireGm();
  const existing = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!existing) throw new UserError("That tag no longer exists.");
  if (!existing.custom) {
    throw new UserError("That tag comes from docs/tags.yaml — edit it there, or the next sync reverts you.");
  }

  const data = scalarsFrom(input);
  const { expiresInto, removesInto, skillTagIds } = await relationsFrom(input, {
    selfId: tagId,
    selfSlug: existing.slug,
    durationTurns: data.defaultDurationTurns,
  });
  if (data.name !== existing.name) {
    const clash = await prisma.tag.findFirst({ where: { name: data.name, id: { not: tagId } } });
    if (clash) throw new UserError(`A tag called "${data.name}" already exists.`);
  }

  // The slug stays fixed after creation: Document.tagSlugs and every other
  // slug reference is a plain string with no foreign key to follow.
  const tag = await prisma.tag.update({
    where: { id: tagId },
    data: {
      ...data,
      expiresInto,
      removesInto,
      // `set`, not `connect` — emptying the picker has to actually detach the
      // old skills, and `connect` only ever adds.
      requirementSkills: { set: skillTagIds.map((id) => ({ id })) },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_custom_tag_updated",
      details: { tagId, name: tag.name },
    },
  });

  revalidatePath("/gm/dev/tags");
  revalidatePath("/character");
  return { tagId, name: tag.name };
}

async function deleteCustomTagImpl({ tagId }) {
  const session = await requireGm();
  if (!isSuperadmin(session.discordUserId)) {
    throw new UserError("Only a superadmin can delete a tag.");
  }

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) throw new UserError("That tag no longer exists.");
  if (!tag.custom) throw new UserError("Only a GM-created tag can be deleted here.");

  // The same reference checks db:prune-tags makes, for the same reason: a
  // deleted tag someone still holds is a foreign-key violation, and a deleted
  // group gate silently opens a hidden category to everyone.
  const [held, parentOf, requiredBy, gates, skillOf] = await Promise.all([
    prisma.characterTag.count({ where: { tagId } }),
    prisma.tag.count({ where: { parentTagId: tagId } }),
    prisma.tag.count({ where: { requiredTagId: tagId } }),
    prisma.tagGroup.count({ where: { requiredTagId: tagId } }),
    prisma.tag.count({ where: { requirementSkills: { some: { id: tagId } } } }),
  ]);
  if (held) throw new UserError(`${held} character${held === 1 ? "" : "s"} still hold that tag.`);
  if (parentOf || requiredBy || gates || skillOf) {
    throw new UserError("Another tag or group references that one.");
  }

  await prisma.tag.delete({ where: { id: tagId } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_custom_tag_deleted",
      details: { tagId, name: tag.name, slug: tag.slug },
    },
  });

  revalidatePath("/gm/dev/tags");
  return { name: tag.name };
}

export async function createCustomTagAndAssign(input) {
  return guarded(() => createCustomTagAndAssignImpl(input));
}
export async function updateCustomTag(input) {
  return guarded(() => updateCustomTagImpl(input));
}
export async function deleteCustomTag(input) {
  return guarded(() => deleteCustomTagImpl(input));
}
