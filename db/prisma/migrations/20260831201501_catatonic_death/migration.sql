-- Catatonic death countdown (TURN-ENGINE.md §2 pass 7b) and the explicit
-- departed-player marker. All additive; no backfill here — the activity-clock
-- backfill is a separate opt-in script (db/prisma/backfill-activity-clock.js).
ALTER TABLE "Character" ADD COLUMN "catatonicSinceTurn" INTEGER;
ALTER TABLE "Character" ADD COLUMN "leftGuildAt" TIMESTAMP(3);
ALTER TABLE "GameConfig" ADD COLUMN "catatonicDeathTurns" INTEGER NOT NULL DEFAULT 4;
