-- Move Adjudication Panel (ADJUDICATION.md §5 Phase 2): the Passed status
-- Routines land in, GM review stamps, the cooperative lock, and the snapshot
-- of what a Solve pushed.
ALTER TYPE "MoveReviewStatus" ADD VALUE 'PASSED';

ALTER TABLE "Action"
  ADD COLUMN "reviewedAt"              TIMESTAMP(3),
  ADD COLUMN "reviewedByDiscordUserId" TEXT,
  ADD COLUMN "lockedByDiscordUserId"   TEXT,
  ADD COLUMN "lockExpiresAt"           TIMESTAMP(3),
  ADD COLUMN "appliedEffects"          JSONB;
