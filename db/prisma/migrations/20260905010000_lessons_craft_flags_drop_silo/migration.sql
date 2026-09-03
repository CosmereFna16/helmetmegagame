-- Teaching, Craft, the capability flags, and the end of Faction Silos
-- (docs/systemdocs/LESSONS.md, CRAFTING.md, FACTIONS.md). Written by hand for
-- `migrate deploy`. The enum additions come first and nothing below uses the
-- new values, so the whole file runs in one transaction.

ALTER TYPE "TagSource" ADD VALUE 'LESSON';
ALTER TYPE "TagSource" ADD VALUE 'CRAFT';

ALTER TABLE "Tag" ADD COLUMN "healable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tag" ADD COLUMN "teachable" BOOLEAN NOT NULL DEFAULT false;

-- Offers: the consent handshake behind Learn / Teach / Bind.
CREATE TYPE "OfferKind" AS ENUM ('LESSON', 'BIND');
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'RESOLVED');

CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "turnId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "teacherId" TEXT,
    "learnerId" TEXT,
    "tagId" TEXT,
    "threshold" INTEGER,
    "learnerActionId" TEXT,
    "teacherActionId" TEXT,
    "outcome" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Offer_learnerActionId_key" ON "Offer"("learnerActionId");
CREATE INDEX "Offer_status_turnId_idx" ON "Offer"("status", "turnId");
CREATE INDEX "Offer_responderId_status_idx" ON "Offer"("responderId", "status");
CREATE INDEX "Offer_initiatorId_status_idx" ON "Offer"("initiatorId", "status");
CREATE INDEX "Offer_teacherActionId_idx" ON "Offer"("teacherActionId");

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Craft projects: a multi-turn craft in progress.
CREATE TYPE "CraftStatus" AS ENUM ('ACTIVE', 'DONE', 'CANCELLED');

CREATE TABLE "CraftProject" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "turnsNeeded" INTEGER NOT NULL,
    "turnsDone" INTEGER NOT NULL DEFAULT 0,
    "resourcesCost" INTEGER NOT NULL DEFAULT 0,
    "payerKey" TEXT,
    "payerName" TEXT,
    "status" "CraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedTurnId" TEXT NOT NULL,
    "lastTurnId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CraftProject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CraftProject_characterId_status_idx" ON "CraftProject"("characterId", "status");

ALTER TABLE "CraftProject" ADD CONSTRAINT "CraftProject_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CraftProject" ADD CONSTRAINT "CraftProject_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Faction Silos are gone.
DROP TABLE "SiloTransaction";
ALTER TABLE "Faction" DROP CONSTRAINT "Faction_siloZoneId_fkey";
ALTER TABLE "Faction" DROP COLUMN "siloZoneId";
ALTER TABLE "Faction" DROP COLUMN "silo";
DROP TYPE "SiloRowVisibility";
