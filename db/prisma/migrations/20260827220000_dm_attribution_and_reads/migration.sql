-- Attribution and read-state for the GM message inbox.
--
-- DirectMessage gains who sent it (authorDiscordUserId — a GM, or null for
-- the bot and for inbound rows), what kind of send it was (source), the
-- Discord message id, and a meta blob (attachment names, embed marker).
-- Everything is nullable, so the currently deployed build keeps writing rows
-- untouched until the new one takes traffic; pre-migration rows simply have
-- no attribution and render as "Bascinet".
--
-- ConversationRead is the per-GM read cursor: a conversation is unread for a
-- GM when any INBOUND row is newer than their lastReadAt. ConversationMeta
-- holds conversation-level state, currently just advisory claiming. Both
-- follow the log-table convention — snapshot ids, no foreign keys.

-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN     "authorDiscordUserId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "discordMessageId" TEXT,
ADD COLUMN     "meta" JSONB;

-- CreateTable
CREATE TABLE "ConversationRead" (
    "id" TEXT NOT NULL,
    "gmDiscordUserId" TEXT NOT NULL,
    "playerDiscordUserId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMeta" (
    "id" TEXT NOT NULL,
    "playerDiscordUserId" TEXT NOT NULL,
    "claimedByDiscordUserId" TEXT,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "ConversationMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectMessage_direction_discordUserId_createdAt_idx" ON "DirectMessage"("direction", "discordUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRead_gmDiscordUserId_playerDiscordUserId_key" ON "ConversationRead"("gmDiscordUserId", "playerDiscordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMeta_playerDiscordUserId_key" ON "ConversationMeta"("playerDiscordUserId");
