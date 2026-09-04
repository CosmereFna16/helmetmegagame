-- Room stashes and carry caps (docs/systemdocs/CARRY.md). Additive only.

ALTER TABLE "Room" ADD COLUMN "resources" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RoomTag" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "expiresTurn" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomTag_roomId_tagId_key" ON "RoomTag"("roomId", "tagId");
CREATE INDEX "RoomTag_tagId_idx" ON "RoomTag"("tagId");
CREATE INDEX "RoomTag_expiresTurn_idx" ON "RoomTag"("expiresTurn");

ALTER TABLE "RoomTag" ADD CONSTRAINT "RoomTag_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomTag" ADD CONSTRAINT "RoomTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Tag" ADD COLUMN "carryMultiplier" DOUBLE PRECISION;

ALTER TABLE "GameConfig" ADD COLUMN "carryTagCap" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "GameConfig" ADD COLUMN "carryResourceCap" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "Character" ADD COLUMN "carryMultiplierSeen" INTEGER NOT NULL DEFAULT 1000;
