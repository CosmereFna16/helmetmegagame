-- DropIndex
DROP INDEX "DirectMessage_discordUserId_idx";

-- CreateIndex
CREATE INDEX "Character_status_idx" ON "Character"("status");

-- CreateIndex
CREATE INDEX "Desire_status_createdAt_idx" ON "Desire"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Desire_characterId_idx" ON "Desire"("characterId");

-- CreateIndex
CREATE INDEX "TagChangeRequest_status_createdAt_idx" ON "TagChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TagChangeRequest_characterId_idx" ON "TagChangeRequest"("characterId");

-- CreateIndex
CREATE INDEX "Action_status_createdAt_idx" ON "Action"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Action_characterId_idx" ON "Action"("characterId");

-- CreateIndex
CREATE INDEX "Action_turnId_idx" ON "Action"("turnId");

-- CreateIndex
CREATE INDEX "DirectMessage_discordUserId_createdAt_idx" ON "DirectMessage"("discordUserId", "createdAt");
