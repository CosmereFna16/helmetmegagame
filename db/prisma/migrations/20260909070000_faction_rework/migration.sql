-- Factions become live: players join, leave, secede and found them, and a
-- faction banks in a Room rather than in a treasury of its own.

-- 1. `slug` becomes the only thing code may branch on, so it can no longer be
--    null. Backfill from `name` (lower, non-alphanumerics to dashes), then
--    de-duplicate by appending the row id's tail, then enforce.
UPDATE "Faction"
   SET "slug" = trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'))
 WHERE "slug" IS NULL;

UPDATE "Faction" f
   SET "slug" = f."slug" || '-' || right(f."id", 6)
 WHERE EXISTS (
   SELECT 1 FROM "Faction" o
    WHERE o."slug" = f."slug" AND o."id" <> f."id" AND o."createdAt" <= f."createdAt"
 );

UPDATE "Faction" SET "slug" = "id" WHERE "slug" IS NULL OR "slug" = '';

ALTER TABLE "Faction" ALTER COLUMN "slug" SET NOT NULL;

-- 2. The silo pointer and the founder stamp.
ALTER TABLE "Faction" ADD COLUMN "siloRoomId" TEXT;
ALTER TABLE "Faction" ADD COLUMN "foundedById" TEXT;

ALTER TABLE "Faction"
  ADD CONSTRAINT "Faction_siloRoomId_fkey"
  FOREIGN KEY ("siloRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Applications and invites.
CREATE TYPE "FactionApplicationKind" AS ENUM ('APPLICATION', 'INVITE');
CREATE TYPE "FactionApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

CREATE TABLE "FactionApplication" (
    "id" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" "FactionApplicationKind" NOT NULL,
    "status" "FactionApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FactionApplication_factionId_status_idx" ON "FactionApplication"("factionId", "status");
CREATE INDEX "FactionApplication_characterId_status_idx" ON "FactionApplication"("characterId", "status");

-- One live handshake per (faction, character) pair, in either direction. A
-- partial index rather than a plain unique one, so the settled rows pile up
-- as history without blocking the next application.
CREATE UNIQUE INDEX "FactionApplication_pending_unique"
    ON "FactionApplication"("factionId", "characterId")
 WHERE "status" = 'PENDING';

ALTER TABLE "FactionApplication"
  ADD CONSTRAINT "FactionApplication_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactionApplication"
  ADD CONSTRAINT "FactionApplication_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
