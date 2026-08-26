-- Adds the Dev Panel switch that locks the Merchant and every Windlands role
-- out of character creation for a playtest. Defaults to false so an existing
-- game keeps its whole roster; see docs/systemdocs/CHARACTERS.md §2.

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "playtestModeEnabled" BOOLEAN NOT NULL DEFAULT false;
