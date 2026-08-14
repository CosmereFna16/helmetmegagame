-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('ALIVE', 'DEAD', 'CURSED');

-- CreateEnum
CREATE TYPE "MoodState" AS ENUM ('NEUTRAL', 'HAPPY', 'UNHAPPY');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('EFFORT', 'MOVE');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ADJUDICATED');

-- CreateEnum
CREATE TYPE "DesireStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TurnPhase" AS ENUM ('DAWN', 'DUSK');

-- CreateEnum
CREATE TYPE "TurnStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('POINT_BUY', 'DESIRE_REWARD', 'GM_GRANT', 'EVENT');

-- CreateTable
CREATE TABLE "GameConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "startingTagPoints" INTEGER NOT NULL DEFAULT 0,
    "resourceConsumptionPerTurn" INTEGER NOT NULL DEFAULT 1,
    "moodDurationTurns" INTEGER NOT NULL DEFAULT 2,
    "hungerMovePenalty" INTEGER NOT NULL DEFAULT -1,
    "moodMovePenalty" INTEGER NOT NULL DEFAULT -1,
    "moodMoveBonus" INTEGER NOT NULL DEFAULT 1,
    "tupperChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summaryChannelId" TEXT,

    CONSTRAINT "GameConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discordChannelIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleTitle" TEXT,
    "factionId" TEXT,
    "zoneId" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "status" "CharacterStatus" NOT NULL DEFAULT 'ALIVE',
    "resources" INTEGER NOT NULL DEFAULT 0,
    "tagPoints" INTEGER NOT NULL DEFAULT 0,
    "moodState" "MoodState" NOT NULL DEFAULT 'NEUTRAL',
    "moodExpiresTurn" INTEGER,
    "isHungry" BOOLEAN NOT NULL DEFAULT false,
    "avatarData" BYTEA,
    "avatarMimeType" TEXT,
    "appearance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointCost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterTag" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" "TagSource" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desire" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DesireStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Desire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "phase" "TurnPhase" NOT NULL,
    "gameDate" TIMESTAMP(3) NOT NULL,
    "status" "TurnStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "description" TEXT NOT NULL,
    "zoneId" TEXT,
    "resourceDelta" INTEGER,
    "diceRoll" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "gmNotes" TEXT,
    "forumThreadId" TEXT,
    "confirmDmMessageId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultEffort" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "resourceDelta" INTEGER,
    "setByCharacterId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefaultEffort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorDiscordUserId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetCharacterId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Faction_discordRoleId_key" ON "Faction"("discordRoleId");

-- CreateIndex
CREATE INDEX "Character_discordUserId_idx" ON "Character"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterTag_characterId_tagId_key" ON "CharacterTag"("characterId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_number_key" ON "Turn"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Action_confirmDmMessageId_key" ON "Action"("confirmDmMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "DefaultEffort_characterId_key" ON "DefaultEffort"("characterId");

-- CreateIndex
CREATE INDEX "AuditLog_actionType_idx" ON "AuditLog"("actionType");

-- CreateIndex
CREATE INDEX "AuditLog_actorDiscordUserId_idx" ON "AuditLog"("actorDiscordUserId");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTag" ADD CONSTRAINT "CharacterTag_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTag" ADD CONSTRAINT "CharacterTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desire" ADD CONSTRAINT "Desire_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultEffort" ADD CONSTRAINT "DefaultEffort_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultEffort" ADD CONSTRAINT "DefaultEffort_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultEffort" ADD CONSTRAINT "DefaultEffort_setByCharacterId_fkey" FOREIGN KEY ("setByCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
