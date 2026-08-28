-- GmAssignment: one row per seat, so a GM can hold several zones.
--
-- The old shape was one nullable zoneId keyed on discordUserId, where a NULL
-- zoneId and a missing row both meant "no seat". Only the missing row survives
-- as that state now, so the NULL rows are dropped rather than migrated -- they
-- carry nothing but their own absence.
DELETE FROM "GmAssignment" WHERE "zoneId" IS NULL;

-- A CAVE_LEVEL seat was reachable from the old picker, which listed every Zone
-- row. Nothing is ever stamped with a cave level (db/lib/seatZone.js maps them
-- all to the Caves group), so such a seat saw an empty table. Re-point them at
-- the group they belong to, then drop any duplicate the re-point created.
UPDATE "GmAssignment" a
SET "zoneId" = z."parentZoneId"
FROM "Zone" z
WHERE z."id" = a."zoneId" AND z."kind" = 'CAVE_LEVEL' AND z."parentZoneId" IS NOT NULL;

DELETE FROM "GmAssignment" a
USING "GmAssignment" b
WHERE a."discordUserId" = b."discordUserId"
  AND a."zoneId" = b."zoneId"
  AND a.ctid > b.ctid;

ALTER TABLE "GmAssignment" DROP CONSTRAINT "GmAssignment_zoneId_fkey";
ALTER TABLE "GmAssignment" DROP CONSTRAINT "GmAssignment_pkey";
ALTER TABLE "GmAssignment" ALTER COLUMN "zoneId" SET NOT NULL;
ALTER TABLE "GmAssignment" ADD CONSTRAINT "GmAssignment_pkey" PRIMARY KEY ("discordUserId", "zoneId");
ALTER TABLE "GmAssignment" ADD CONSTRAINT "GmAssignment_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "GmAssignment_discordUserId_idx" ON "GmAssignment"("discordUserId");
