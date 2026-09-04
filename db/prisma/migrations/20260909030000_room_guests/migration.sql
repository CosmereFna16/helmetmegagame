-- A character let into a private Room by hand (/add) rather than by holding
-- one of its access tags. Spent when they leave the Room's Location, which
-- db/lib/roomAccess.js#syncCharacterRoomAccess enforces on every arrival.
CREATE TABLE "RoomGuest" (
    "roomId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomGuest_pkey" PRIMARY KEY ("roomId","characterId")
);

CREATE INDEX "RoomGuest_characterId_idx" ON "RoomGuest"("characterId");

ALTER TABLE "RoomGuest" ADD CONSTRAINT "RoomGuest_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoomGuest" ADD CONSTRAINT "RoomGuest_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
