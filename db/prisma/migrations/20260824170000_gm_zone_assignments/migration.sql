-- Zone seats for the four zone-GMs. Purely additive: a new table and one
-- nullable FK, nothing rewritten, so the ordinary push -> migrate -> redeploy
-- order in `npm run deploy` is correct here.
--
-- ON DELETE SET NULL is load-bearing: `npm run db:sync-locations` is
-- destructive and will delete a Zone row that has left docs/locations.yaml.
-- A cascade would take the GM's seat with it silently.
CREATE TABLE "GmAssignment" (
    "discordUserId" TEXT NOT NULL,
    "zoneId" TEXT,
    "assignedByDiscordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmAssignment_pkey" PRIMARY KEY ("discordUserId")
);

CREATE INDEX "GmAssignment_zoneId_idx" ON "GmAssignment"("zoneId");

ALTER TABLE "GmAssignment" ADD CONSTRAINT "GmAssignment_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
