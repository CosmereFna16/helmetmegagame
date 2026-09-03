-- Corpses as objects. See docs/systemdocs/CORPSES.md.
--
-- A dead character now leaves a real, carryable Tag behind, and that tag is a
-- HANDLE to their sheet rather than a container: the goods stay on the row and
-- LOOT_CHARACTER is unchanged, but the dead sheet's Location follows its corpse
-- around. Three columns carry the whole idea.
--
-- Tag.corpseKind is the discriminator, set on both the three monster corpses
-- from docs/tags.yaml and the pair db/lib/characterDeath.js writes per death.
-- Tag.corpseOfCharacterId is what makes one a handle to a specific body; it is
-- null on a monster. SetNull rather than Cascade on purpose — wipeGameData
-- deletes Character rows and these Tag rows in the same transaction, and a
-- cascade would pull catalog rows out from under the explicit delete.
--
-- Tag.requirementItems is unrelated to death but arrives with it: the first
-- recipe ingredient this game has ever actually enforced. Miasma needs a corpse
-- and Dreamer's Draught a Skinless Brain, and neither is consumed by the craft.
-- Json rather than a relation because Miasma's ingredient is a whole GROUP —
-- a corpse written at death is never in the YAML, so no authored relation could
-- name one.
--
-- No backfill. Nobody has died yet, and the monster corpses arrive by the next
-- `npm run db:sync-tags`.

-- Written IF-NOT-EXISTS throughout. This one was applied by hand against a
-- shared database (two other sessions had pending migrations of their own that
-- must not be dragged along by a `migrate deploy`), then marked resolved — so
-- it has to be safe to re-run.

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'ENGRAVE_HEADSTONE';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'BUTCHER_CORPSE';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CorpseKind" AS ENUM ('FRESH', 'ROTTEN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "corpseKind" "CorpseKind";
ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "corpseOfCharacterId" TEXT;
ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "requirementItems" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_corpseOfCharacterId_key" ON "Tag"("corpseOfCharacterId");
CREATE INDEX IF NOT EXISTS "Tag_corpseKind_idx" ON "Tag"("corpseKind");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Tag" ADD CONSTRAINT "Tag_corpseOfCharacterId_fkey"
    FOREIGN KEY ("corpseOfCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
