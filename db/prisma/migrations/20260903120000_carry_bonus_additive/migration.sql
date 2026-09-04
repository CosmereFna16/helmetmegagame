-- Tag.carryMultiplier -> Tag.carryBonus.
--
-- The caps used to be the PRODUCT of every active multiplier and are now the
-- SUM of every active bonus, so the column stores a signed distance from x1
-- rather than a factor: Cart 5 becomes 4, Giant 1.75 becomes 0.75, and a
-- penalty like Frail is simply negative. Rename first, then rewrite the values
-- that are already there, so no row is left reading as a factor.
--
-- EDITED 2026-09-03 to be guarded: this migration is hand-dated 20260903,
-- which sorts BEFORE 20260904010000_room_stash_carry — the migration that
-- CREATES carryMultiplier. Environments that applied the two in arrival
-- order (production) are fine, but a fresh replay in name order (the shadow
-- database behind every `prisma migrate dev`, or any new environment) hit
-- the rename before the column existed and died, which blocked `migrate dev`
-- for everyone. The guard makes this step a no-op on such a replay, and
-- 20260910020000_carry_bonus_additive_resorted (a twin with the same guard,
-- dated after room_stash_carry) does the rename where this one skipped it.
-- Exactly one of the two ever fires. `migrate deploy` never re-reads an
-- applied migration's contents, so environments that already ran the
-- original are unaffected by this edit.
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
