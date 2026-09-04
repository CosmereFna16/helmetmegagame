-- The Company's line drops from 60 obols to 15. The Merchant's own float drops
-- with it (roles.yaml: Obol x20 -> Obol x6, about 30 ⬢ at the default rate), so
-- he starts the game short of money rather than able to buy the shelf outright.
--
-- The live row is updated too, not just the default: the Depot singleton is
-- created on first touch and would otherwise keep the old cap forever.
ALTER TABLE "Depot" ALTER COLUMN "creditCapObols" SET DEFAULT 15;
UPDATE "Depot" SET "creditCapObols" = 15 WHERE "id" = 1;
