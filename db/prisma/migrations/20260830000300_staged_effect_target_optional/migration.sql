-- A Silo -> Silo staged transfer has no character end, so StagedEffect's
-- target can no longer be required. Non-destructive: existing rows already
-- carry a value and are unaffected.
ALTER TABLE "StagedEffect" ALTER COLUMN "targetCharacterId" DROP NOT NULL;
