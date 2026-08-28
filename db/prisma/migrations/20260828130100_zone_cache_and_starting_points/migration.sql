-- The zone cache: an Item put down on the ground where anyone standing in the
-- zone can take it. See model ZoneCache in schema.prisma.
CREATE TABLE "ZoneCache" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "droppedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneCache_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ZoneCache_zoneId_idx" ON "ZoneCache"("zoneId");
CREATE INDEX "ZoneCache_tagId_idx" ON "ZoneCache"("tagId");

ALTER TABLE "ZoneCache" ADD CONSTRAINT "ZoneCache_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZoneCache" ADD CONSTRAINT "ZoneCache_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Starting point-buy budget drops from 12 to 5. The column default alone
-- would never touch the existing GameConfig singleton, and the live value is
-- the point of the change — so the row moves too, guarded on the old default
-- so a value a GM deliberately set to something else survives.
ALTER TABLE "GameConfig" ALTER COLUMN "startingTagPoints" SET DEFAULT 5;
UPDATE "GameConfig" SET "startingTagPoints" = 5 WHERE "startingTagPoints" = 12;
