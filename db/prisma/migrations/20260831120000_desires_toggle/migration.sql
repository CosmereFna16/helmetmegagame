-- Adds the Dev Panel switch that turns off players setting a NEW Desire.
-- Defaults to true so every existing game keeps the mechanic on; see
-- docs/systemdocs/REQUESTS.md §5.

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "desiresEnabled" BOOLEAN NOT NULL DEFAULT true;
