-- Weight replaces the item count, and the free zone move replaces the
-- Overburdened wall. docs/systemdocs/CARRY.md.

-- What one unit of a tag weighs. Null = weightless (skills, statuses, assets).
ALTER TABLE "Tag" ADD COLUMN "weightLbs" DOUBLE PRECISION;

-- The item-count cap becomes a pound cap.
ALTER TABLE "GameConfig" DROP COLUMN "carryTagCap";
ALTER TABLE "GameConfig" ADD COLUMN "carryWeightLbs" INTEGER NOT NULL DEFAULT 120;

-- Free zone crossings per character per turn, before a crossing spends the Move.
ALTER TABLE "GameConfig" ADD COLUMN "freeZoneMovesPerTurn" INTEGER NOT NULL DEFAULT 1;

-- The overflow drop is acquisition-driven now, so the multiplier-shrink
-- watermark has nothing left to detect.
ALTER TABLE "Character" DROP COLUMN "carryMultiplierSeen";

-- The mount's once-a-DAY claim becomes a per-TURN allowance counter.
ALTER TABLE "Character" DROP COLUMN "fastTravelTurnId";
ALTER TABLE "Character" ADD COLUMN "zoneMovesTurnId" TEXT;
ALTER TABLE "Character" ADD COLUMN "zoneMovesUsed" INTEGER NOT NULL DEFAULT 0;

-- A place you walk into: mounts and carts are parked at the door.
ALTER TABLE "Location" ADD COLUMN "indoors" BOOLEAN NOT NULL DEFAULT false;
