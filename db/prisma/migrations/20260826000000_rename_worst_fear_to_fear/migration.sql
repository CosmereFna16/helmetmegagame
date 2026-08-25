-- Rename the "Worst Fear" mechanic to "Fear" at the code level.
-- These are RENAMEs, not drop/create: existing character data and enum
-- usages are preserved in place.

ALTER TABLE "Character" RENAME COLUMN "worstFear" TO "fear";
ALTER TABLE "Character" RENAME COLUMN "worstFearSetTurnNumber" TO "fearSetTurnNumber";
ALTER TABLE "Character" RENAME COLUMN "worstFearLastFulfilledTurn" TO "fearLastFulfilledTurn";

ALTER TYPE "RequestType" RENAME VALUE 'CHANGE_WORST_FEAR' TO 'CHANGE_FEAR';
ALTER TYPE "RequestType" RENAME VALUE 'FULFILL_WORST_FEAR' TO 'FULFILL_FEAR';

ALTER TYPE "ArchiveKind" RENAME VALUE 'WORST_FEAR_FULFILLED' TO 'FEAR_FULFILLED';
