"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { isSuperadmin } from "@/lib/superadmin";
import { getGmSession, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";
import { applyTagOpsInTx } from "@/lib/characterWrite";
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

// The subset of Tag a GM may set from the UI. Everything absent from this
// list — parentTagId, requiredTagId, requirementSkills, consumesInto — is
// catalog structure that belongs in docs/tags.yaml, where it can be reviewed
// and version-controlled alongside the tags it wires together.
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
    purchasable: Boolean(input.purchasable),
    purchasableAfterStart: Boolean(input.purchasableAfterStart),
    sellable,
    sellablePrice,
    defaultDurationTurns: duration,
  };
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
    return tx.tag.create({ data: { ...data, slug, custom: true } });
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

  // A live grant may change narrowcast access (#watch, #intercom), same as
  // bulkTagCharacters. Sequential and after the writes, per ARCHITECTURE.md
  // §5 — never a fan-out of REST calls at Discord's rate limiter. A staged
  // grant hasn't touched anyone's holdings yet, so it's skipped here.
  if (applied.length && !result.staged) {
    after(async () => {
      for (const characterId of applied) {
        await syncCharacterNarrowcastAccess(characterId).catch(() => {});
      }
    });
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
  if (data.name !== existing.name) {
    const clash = await prisma.tag.findFirst({ where: { name: data.name, id: { not: tagId } } });
    if (clash) throw new UserError(`A tag called "${data.name}" already exists.`);
  }

  // The slug stays fixed after creation: Document.tagSlugs and every other
  // slug reference is a plain string with no foreign key to follow.
  const tag = await prisma.tag.update({ where: { id: tagId }, data });

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
