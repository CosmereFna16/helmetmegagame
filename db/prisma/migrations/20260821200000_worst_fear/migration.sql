-- AlterEnum
-- Postgres only refuses to USE a new enum value in the transaction that adds
-- it; nothing below references these, so one file is fine (same shape as
-- 20260821180000_consumable_tags).
ALTER TYPE "RequestType" ADD VALUE 'CHANGE_WORST_FEAR';
ALTER TYPE "RequestType" ADD VALUE 'FULFILL_WORST_FEAR';

-- AlterTable
-- The Worst Fear: one persistent, self-set dread per character. Three
-- nullable columns rather than a table — there is exactly one, it has no
-- lifecycle, and Undo restores the previous text from Request.effect.
ALTER TABLE "Character" ADD COLUMN     "worstFear" TEXT,
                        ADD COLUMN     "worstFearSetTurnNumber" INTEGER,
                        ADD COLUMN     "worstFearLastFulfilledTurn" INTEGER;
