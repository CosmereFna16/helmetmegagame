-- MIGRATION weather ("a flock of black birds, a bad omen") is cut from the
-- game, leaving the Weather enum matching the four weather photos exactly.
--
-- Postgres cannot drop a value from an enum in place, so the type has to be
-- recreated. Two things make this order load-bearing:
--   1. Any surviving MIGRATION row must be rewritten BEFORE the cast, or the
--      USING clause aborts on it.
--   2. Turn.weather's DEFAULT references the old type and blocks the swap,
--      so it is dropped and re-set around it.
UPDATE "Turn" SET "weather" = 'CLEAR' WHERE "weather" = 'MIGRATION';
UPDATE "GameConfig" SET "nextWeather" = 'CLEAR' WHERE "nextWeather" = 'MIGRATION';

ALTER TYPE "Weather" RENAME TO "Weather_old";
CREATE TYPE "Weather" AS ENUM ('CLEAR', 'FOG', 'RAIN', 'STORM');
ALTER TABLE "Turn" ALTER COLUMN "weather" DROP DEFAULT;
ALTER TABLE "Turn" ALTER COLUMN "weather" TYPE "Weather" USING ("weather"::text::"Weather");
ALTER TABLE "GameConfig" ALTER COLUMN "nextWeather" TYPE "Weather" USING ("nextWeather"::text::"Weather");
ALTER TABLE "Turn" ALTER COLUMN "weather" SET DEFAULT 'CLEAR';
DROP TYPE "Weather_old";

-- The #turns weather banner is its own message (Discord puts attachments
-- below their message content), so its id is tracked alongside the
-- announcement's and both are replaced each turn.
ALTER TABLE "GameConfig" ADD COLUMN "turnsBannerMessageId" TEXT;
