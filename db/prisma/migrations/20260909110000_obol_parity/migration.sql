-- An obol is one ⬢, so there is no rate left to store.
--
-- The rate used to be 5, and it broke the bottom of the price table: a 3 ⬢ cup
-- of tea cost a whole coin to buy (the counter paid the ceiling) and paid
-- nothing at all to sell (it paid the floor). Thirty-two wares sold for under
-- one coin and were therefore worth exactly zero at the counter.
--
-- At parity every authored price is already a whole number of obols, so the
-- conversion helpers, the ⬢/¢ display toggle and this column are all gone. The
-- catalog still prices in ⬢ — that is what a thing is WORTH — and an obol is
-- now simply that same value made physical: a stackable tag you can carry,
-- trade, stash and have stolen.
--
-- The value moves and the x5 rescale of every authored obol amount landed in
-- 20260903120000_godard_factory. This only removes the column.
ALTER TABLE "Depot" DROP COLUMN IF EXISTS "obolRate";

-- debtObols was missed by that rescale. It is 0 on the live row, so this is a
-- no-op there, but a restored backup taken mid-game would otherwise keep a
-- debt denominated at the old rate.
UPDATE "Depot" SET "debtObols" = "debtObols" * 5 WHERE "debtObols" > 0;

-- The Company's line was 15 ¢ when a coin was worth 5 ⬢. At parity it has to be
-- 75 to buy the same shelf. Written here as well as in the migration above so
-- this one is correct on its own, against a database rebuilt from scratch.
-- Both statements are no-ops on a row that already reads 75.
ALTER TABLE "Depot" ALTER COLUMN "creditCapObols" SET DEFAULT 75;
UPDATE "Depot" SET "creditCapObols" = 75 WHERE "creditCapObols" = 15;
