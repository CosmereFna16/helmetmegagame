-- The correctly-sorted twin of 20260903120000_carry_bonus_additive.
--
-- That migration was hand-dated before 20260904010000_room_stash_carry, the
-- migration that CREATES carryMultiplier, so on a fresh name-order replay it
-- ran before its column existed. It is now guarded to skip in that case, and
-- this twin — sorted after room_stash_carry — performs the identical change
-- where the original skipped it. The guard means exactly one of the two ever
-- fires: on production (original already applied, column already renamed)
-- this is a no-op; on a fresh replay this is where the rename happens.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_name = 'Tag' AND column_name = 'carryMultiplier'
  ) THEN
    ALTER TABLE "Tag" RENAME COLUMN "carryMultiplier" TO "carryBonus";
    UPDATE "Tag" SET "carryBonus" = "carryBonus" - 1 WHERE "carryBonus" IS NOT NULL;
  END IF;
END $$;
