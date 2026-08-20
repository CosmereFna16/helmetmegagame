-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "roleId" TEXT,
ADD COLUMN     "tagPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Faction" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "playerCount" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "startingTagPoints" INTEGER NOT NULL DEFAULT 12;

-- CreateTable
CREATE TABLE "Player" (
    "discordUserId" TEXT NOT NULL,
    "cursed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("discordUserId")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT NOT NULL DEFAULT '',
    "description" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "factionId" TEXT NOT NULL,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER,
    "startingResources" INTEGER NOT NULL DEFAULT 0,
    "extraStartingPoints" INTEGER NOT NULL DEFAULT 0,
    "startingTagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grantsLeader" BOOLEAN NOT NULL DEFAULT false,
    "grantsTreasurer" BOOLEAN NOT NULL DEFAULT false,
    "docElements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startingLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialChannel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "isTupper" BOOLEAN NOT NULL DEFAULT true,
    "discordChannelId" TEXT,
    "viewTagId" TEXT,
    "sendTagId" TEXT,
    "discordViewRoleId" TEXT,
    "discordSendRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_slug_key" ON "Role"("slug");

-- CreateIndex
CREATE INDEX "Role_factionId_idx" ON "Role"("factionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialChannel_slug_key" ON "SpecialChannel"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Faction_slug_key" ON "Faction"("slug");

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_startingLocationId_fkey" FOREIGN KEY ("startingLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialChannel" ADD CONSTRAINT "SpecialChannel_viewTagId_fkey" FOREIGN KEY ("viewTagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialChannel" ADD CONSTRAINT "SpecialChannel_sendTagId_fkey" FOREIGN KEY ("sendTagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

