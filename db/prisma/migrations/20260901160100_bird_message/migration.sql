-- The Bird: one letter a day to a named person in a guessed zone
-- (docs/systemdocs/BIRD.md). All additive, no backfill.
--
-- Character.birdTurnId is the once-a-day claim token, holding the in-game DAY
-- and not a turn id — the same shape and the same trap as fastTravelTurnId
-- beside it. TEXT and nullable: every existing character starts having never
-- sent one.
ALTER TABLE "Character" ADD COLUMN "birdTurnId" TEXT;

-- Every party is a snapshot rather than a foreign key, so a letter still reads
-- back correctly after its sender or recipient is deleted, and so the reply
-- handler can answer with no join at all.
CREATE TABLE "BirdMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderDiscordUserId" TEXT,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientDiscordUserId" TEXT,
    "guessedZoneId" TEXT NOT NULL,
    "guessedZoneName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "arrivalTurnId" TEXT,
    "replyDeadlineTurn" INTEGER,
    "failureNotifiedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "replyBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirdMessage_pkey" PRIMARY KEY ("id")
);

-- The failure pass's own query, run once per turn close: undelivered letters
-- whose sender has not yet been told.
CREATE INDEX "BirdMessage_delivered_failureNotifiedAt_idx" ON "BirdMessage"("delivered", "failureNotifiedAt");
CREATE INDEX "BirdMessage_recipientId_idx" ON "BirdMessage"("recipientId");
CREATE INDEX "BirdMessage_senderId_idx" ON "BirdMessage"("senderId");
