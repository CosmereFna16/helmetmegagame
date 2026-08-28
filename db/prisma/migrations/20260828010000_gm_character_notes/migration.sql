-- A GM's own notes about a player, shown on the player desk's dossier.
-- Purely additive: a new table and its index, nothing altered or dropped.
CREATE TABLE "GmCharacterNote" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "authorDiscordUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmCharacterNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GmCharacterNote_characterId_createdAt_idx" ON "GmCharacterNote"("characterId", "createdAt");

ALTER TABLE "GmCharacterNote" ADD CONSTRAINT "GmCharacterNote_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
