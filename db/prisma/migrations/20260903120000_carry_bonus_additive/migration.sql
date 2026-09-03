-- Tag.carryMultiplier -> Tag.carryBonus.
--
-- The caps used to be the PRODUCT of every active multiplier and are now the
-- SUM of every active bonus, so the column stores a signed distance from x1
-- rather than a factor: Cart 5 becomes 4, Giant 1.75 becomes 0.75, and a
-- penalty like Frail is simply negative. Rename first, then rewrite the values
-- that are already there, so no row is left reading as a factor.
ALTER TABLE "Tag" RENAME COLUMN "carryMultiplier" TO "carryBonus";
UPDATE "Tag" SET "carryBonus" = "carryBonus" - 1 WHERE "carryBonus" IS NOT NULL;
