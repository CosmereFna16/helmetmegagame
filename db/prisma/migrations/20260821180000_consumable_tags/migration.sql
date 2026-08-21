-- AlterEnum
-- Must come first and stand alone: Postgres refuses to use a new enum value in
-- the same transaction that adds it. Nothing below references it, so one file
-- is still fine.
ALTER TYPE "RequestType" ADD VALUE 'CONSUME_TAG';

-- AlterTable
-- grantsOnExpiry ("expires into") is replaced by the Consume system: the
-- player chooses when to use a tag up rather than waiting for a timer.
ALTER TABLE "Tag" ADD COLUMN     "consumable" BOOLEAN NOT NULL DEFAULT false,
                 ADD COLUMN     "consumesInto" TEXT[],
                 DROP COLUMN    "grantsOnExpiry";
