/*
  Warnings:

  - You are about to drop the column `lifewebDrainedDurationTurns` on the `GameConfig` table. That column's role is replaced by `Tag.defaultDurationTurns` (set to 3 for Drained via docs/tags.yaml), computed generically at grant time instead of read from a bespoke config knob.

*/
-- AlterTable
ALTER TABLE "GameConfig" DROP COLUMN "lifewebDrainedDurationTurns";
