-- AlterTable
-- Per-target conditions on Tag.consumesInto, as
-- { "<target slug>": ["<blocking slug>", ...] }: the target is granted only if
-- the character holds none of its blocking tags. Nullable because almost every
-- consumable's grants are unconditional; consumesInto itself is unchanged and
-- still lists every target.
ALTER TABLE "Tag" ADD COLUMN "consumesIntoUnless" JSONB;
