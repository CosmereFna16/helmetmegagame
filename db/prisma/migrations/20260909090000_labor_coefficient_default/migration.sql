-- Laboring comes down about 7%. The dial is the global one, so this is the
-- default a Restart Game wipe restores; the live row is set alongside it.
ALTER TABLE "GameConfig" ALTER COLUMN "productionCoefficient" SET DEFAULT 0.93;
UPDATE "GameConfig" SET "productionCoefficient" = 0.93 WHERE "productionCoefficient" = 1;
