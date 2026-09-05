-- The Caving Die is arrival-only now, and rolls once per Location per turn
-- rather than once per turn. See docs/systemdocs/CAVING.md.
ALTER TABLE "CavingRoll" ADD COLUMN "locationId" TEXT;

ALTER TABLE "CavingRoll"
  ADD CONSTRAINT "CavingRoll_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Widened, not replaced by a new name: the index is what caps a repeat fire of
-- the same trigger, and it now has to let a second Location through.
DROP INDEX IF EXISTS "CavingRoll_characterId_turnId_trigger_key";

CREATE UNIQUE INDEX "CavingRoll_characterId_turnId_trigger_locationId_key"
  ON "CavingRoll"("characterId", "turnId", "trigger", "locationId");
