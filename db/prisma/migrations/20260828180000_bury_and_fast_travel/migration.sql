-- Two new request types. The enum is append-only: Postgres cannot drop a value
-- in place, which is why RequestType still carries CREATE_TAG / DROP_ITEM /
-- PICK_UP_ITEM long after those were removed.
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'BURY_CHARACTER';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'FAST_TRAVEL';

-- Both nullable, so there is nothing to backfill: NULL is correct for every
-- existing row. buriedAt is set by a BURY_CHARACTER request and cleared by its
-- Undo (and by a GM revive); fastTravelTurnId is the once-a-day claim token a
-- FAST_TRAVEL writes with a conditional UPDATE.
ALTER TABLE "Character" ADD COLUMN "buriedAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "fastTravelTurnId" TEXT;
