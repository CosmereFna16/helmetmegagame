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

  return {
    name,
    description: (input.description ?? "").toString().trim() || null,
    category,
    pointCost: Number.isInteger(pointCost) ? pointCost : 0,
    groupId: (input.groupId ?? "").toString().trim() || null,
    visibleOnInspect: Boolean(input.visibleOnInspect),
    stackable: Boolean(input.stackable),
    equippable,
    consumable: Boolean(input.consumable),
    removable: Boolean(input.removable),
    tradeable: Boolean(input.tradeable),
    purchasable: Boolean(input.purchasable),
    purchasableAfterStart: Boolean(input.purchasableAfterStart),
    defaultDurationTurns: duration,
  };
}

// The custom-tag dialog's door on every desk — see
// web/app/components/CustomTagDialog.js and DEV-PANEL.md §8. One
// transaction: create the tag (scalarsFrom + slug/name clash check), then
// grant or stage it against whichever targets the door preselected, then one
// audit row for the whole gesture — mirroring bulkTagCharacters' shape
// ((app)/gm/actions.js) rather than duplicating a second convention.
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

  const result = await prisma.$transaction(async (tx) => {
    const clash = await tx.tag.findFirst({
      where: { OR: [{ slug }, { name: data.name }] },
      select: { name: true },
    });
    if (clash) throw new UserError(`A tag called "${clash.name}" already exists.`);

    const tag = await tx.tag.create({ data: { ...data, slug, custom: true } });

    let batchId = null;
    if (targets.length) {
      const found = await tx.character.findMany({ where: { id: { in: targets } }, select: { id: true } });
      if (found.length !== targets.length) throw new UserError("One of those characters no longer exists.");

      const openTurn = await tx.turn.findFirst({ where: { status: "OPEN" } });

      if (stage) {
        if (!openTurn) throw new UserError("No turn is open to stage against.");
        batchId = targets.length > 1 ? crypto.randomUUID() : null;
        const payload = { tagOps: [{ tagId: tag.id, op: "add", quantity: 1 }] };
        await tx.stagedEffect.createMany({
          data: targets.map((targetCharacterId) => ({
            turnId: openTurn.id,
            targetCharacterId,
            createdByDiscordUserId: session.discordUserId,
            batchId,
            payload,
          })),
        });
      } else {
        const config = await tx.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } });
        const tagsById = new Map([[tag.id, tag]]);
        for (const characterId of targets) {
          await applyTagOpsInTx(tx, {
            characterId,
            ops: [{ tagId: tag.id, op: "add", quantity: 1 }],
            tagsById,
            openTurn,
            equipSlots: config?.equipSlots ?? 6,
          });
        }
      }
    }

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_custom_tag_created",
        details: { tagId: tag.id, slug, name: tag.name, characterIds: targets, staged: Boolean(stage && targets.length), batchId },
      },
    });

    return { tagId: tag.id, name: tag.name, slug, applied: targets.length, staged: Boolean(stage && targets.length) };
    // Many targets = many sequential grants; Prisma's default 5 s would roll
    // back a big "Message pinned"-sized batch.
  }, { timeout: 20_000 });

  revalidatePath("/gm/dev/tags");
  revalidatePath("/character");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/players", "layout");

  // A live grant may change narrowcast access (#watch, #intercom), same as
  // bulkTagCharacters. Sequential and after the writes, per ARCHITECTURE.md
  // §5 — never a fan-out of REST calls at Discord's rate limiter. A staged
  // grant hasn't touched anyone's holdings yet, so it's skipped here.
  if (targets.length && !result.staged) {
    after(async () => {
      for (const characterId of targets) {
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
