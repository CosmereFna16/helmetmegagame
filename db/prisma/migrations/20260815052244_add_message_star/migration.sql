-- CreateTable
CREATE TABLE "MessageStar" (
    "id" TEXT NOT NULL,
    "archivedMessageId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageStar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageStar_discordUserId_idx" ON "MessageStar"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageStar_archivedMessageId_discordUserId_key" ON "MessageStar"("archivedMessageId", "discordUserId");

-- AddForeignKey
ALTER TABLE "MessageStar" ADD CONSTRAINT "MessageStar_archivedMessageId_fkey" FOREIGN KEY ("archivedMessageId") REFERENCES "ArchivedMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
