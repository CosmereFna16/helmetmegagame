-- Antagonist opt-ins: which secretly GM-assigned antagonist seats a player is
-- open to being handed. Consent data only — nothing reads it mechanically.
--
-- Additive and defaulted, so currently-deployed code simply ignores the column
-- and every existing character reads as "opted into nothing", which is the
-- correct answer for a player who was never asked.
ALTER TABLE "Character" ADD COLUMN     "antagonistOptIns" TEXT[] DEFAULT ARRAY[]::TEXT[];
