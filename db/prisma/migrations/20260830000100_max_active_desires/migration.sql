-- How many Desires a character may hold ACTIVE at once, editable from /gm/dev.
-- Additive and defaulted, so the live game keeps running while it lands; the
-- old behaviour was a hard-coded "one ACTIVE" in the server actions, and the
-- default of 3 is the new rule, not the old one.

ALTER TABLE "GameConfig" ADD COLUMN "maxActiveDesires" INTEGER NOT NULL DEFAULT 3;
