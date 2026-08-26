-- Adds the Dev Panel switch that turns off the @Leader Whitelist requirement
-- for roles flagged `leader: true`. Defaults to true so every existing game
-- keeps enforcing the gate; see docs/systemdocs/CHARACTERS.md §2.

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "leaderWhitelistEnabled" BOOLEAN NOT NULL DEFAULT true;
