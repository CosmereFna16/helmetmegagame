-- Quiet Silo adjustments (2026-09-02).
--
-- A GM adjudicating a secret move out of a faction Silo — a gambit steal —
-- used to be announced to the victim's Treasurer by the Silo history itself.
-- HIDDEN marks the real, balance-affecting row as GM-only; COVER is a
-- display-only fiction that stands in for it on /faction, carrying the same
-- signed amount so the player-visible column still sums to the real balance.

-- CreateEnum
CREATE TYPE "SiloRowVisibility" AS ENUM ('OPEN', 'HIDDEN', 'COVER');

-- AlterTable
ALTER TABLE "SiloTransaction" ADD COLUMN     "coverForId" TEXT,
ADD COLUMN     "visibility" "SiloRowVisibility" NOT NULL DEFAULT 'OPEN';
