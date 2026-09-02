-- Desires: retroactive claiming, slot-scoped Addictions (2026-09-02).

-- How many whole turns a Desire slot stays shut after a claim lands in it.
-- The pre-rework behaviour was a hardcoded 1; 2 is the new default.
ALTER TABLE "GameConfig" ADD COLUMN "desireSlotLockTurns" INTEGER NOT NULL DEFAULT 2;

-- Nothing writes ACTIVE any more: a Desire row is created FULFILLED.
ALTER TABLE "Desire" ALTER COLUMN "status" SET DEFAULT 'FULFILLED';

-- Release every Desire still in flight. endedTurnNumber stays NULL on purpose
-- so nobody's slots come back from this deploy already locked — under the new
-- rules the player can simply claim the same goal retroactively.
UPDATE "Desire" SET "status" = 'CANCELLED', "endedTurnNumber" = NULL WHERE "status" = 'ACTIVE';
