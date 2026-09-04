-- Room.destroysContents: a room that eats what is put into it. Authored as
-- `destroys: true` in docs/zones.yaml; the Godard Factory's Spillway is the
-- only one. See docs/systemdocs/CARRY.md.
ALTER TABLE "Room" ADD COLUMN     "destroysContents" BOOLEAN NOT NULL DEFAULT false;

-- Two new player-filed request kinds: cutting Godflesh out of the marsh, and
-- packing goods into a crate. See docs/systemdocs/FACTORY.md.
ALTER TYPE "RequestType" ADD VALUE 'EXTRACT_GODFLESH';
ALTER TYPE "RequestType" ADD VALUE 'PACKAGE_ITEMS';

-- Obols are 1:1 with ⬢ now, down from 5:1. The catalog prices in ⬢ and only the
-- counter converts (docs/systemdocs/DEPOT.md §0), so no authored price moves —
-- but every obol anybody holds just lost 80% of its purchasing power, which is
-- why every obol AMOUNT in the masters goes x5 in the same commit. The live
-- rows move here rather than on the next wipe: a default alone would leave the
-- running game at the old rate.
ALTER TABLE "Depot" ALTER COLUMN "obolRate" SET DEFAULT 1;
ALTER TABLE "Depot" ALTER COLUMN "creditCapObols" SET DEFAULT 75;
UPDATE "Depot" SET "obolRate" = 1, "creditCapObols" = 75, "accountObols" = "accountObols" * 5;
