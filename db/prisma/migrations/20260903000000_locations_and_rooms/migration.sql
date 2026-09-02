-- Bascinet 2: a character stands in a Location, not a zone. Locations own a
-- text channel + a "Location: X" role; Rooms are sync-owned threads under it;
-- PlayerThread becomes the Conversation record (private thread linked to a
-- Room, wiped every Dawn). The zone forums, #private, their anchors, the
-- zone travel graph and LocationTopic all go. Wipe-only: the game is not
-- launched, and PlayerThread gains a NOT NULL foreign key, so its rows are
-- deleted rather than migrated.

CREATE TYPE "RoomKind" AS ENUM ('PUBLIC', 'PRIVATE');

DELETE FROM "PlayerThreadInvite";
DELETE FROM "PlayerThread";

-- Location
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "zoneId" TEXT NOT NULL,
    "discordChannelId" TEXT,
    "discordRoleId" TEXT,
    "anchorMessageId" TEXT,
    "anchorHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
CREATE UNIQUE INDEX "Location_discordRoleId_key" ON "Location"("discordRoleId");
CREATE INDEX "Location_zoneId_idx" ON "Location"("zoneId");
ALTER TABLE "Location" ADD CONSTRAINT "Location_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Room
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" "RoomKind" NOT NULL DEFAULT 'PUBLIC',
    "locationId" TEXT NOT NULL,
    "accessTagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discordThreadId" TEXT,
    "starterMessageId" TEXT,
    "postHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Room_slug_key" ON "Room"("slug");
CREATE INDEX "Room_locationId_idx" ON "Room"("locationId");
ALTER TABLE "Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The location travel graph (implicit many-to-many self-relation).
CREATE TABLE "_LocationConnections" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LocationConnections_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_LocationConnections_B_index" ON "_LocationConnections"("B");
ALTER TABLE "_LocationConnections" ADD CONSTRAINT "_LocationConnections_A_fkey" FOREIGN KEY ("A") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_LocationConnections" ADD CONSTRAINT "_LocationConnections_B_fkey" FOREIGN KEY ("B") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Character: where they stand, the walk cooldown, the conceal toggle.
ALTER TABLE "Character"
    ADD COLUMN "locationId" TEXT,
    ADD COLUMN "lastLocationMoveAt" TIMESTAMP(3),
    ADD COLUMN "concealed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Character" ADD CONSTRAINT "Character_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Role: where a new character of this role is placed.
ALTER TABLE "Role" ADD COLUMN "startingLocationId" TEXT;
ALTER TABLE "Role" ADD CONSTRAINT "Role_startingLocationId_fkey" FOREIGN KEY ("startingLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GameConfig: the same-zone walk cooldown.
ALTER TABLE "GameConfig" ADD COLUMN "locationMoveCooldownSeconds" INTEGER NOT NULL DEFAULT 60;

-- PlayerThread -> Conversation.
ALTER TABLE "PlayerThread" DROP CONSTRAINT "PlayerThread_zoneId_fkey";
DROP INDEX "PlayerThread_zoneId_idx";
ALTER TABLE "PlayerThread"
    DROP COLUMN "zoneId",
    DROP COLUMN "kind",
    DROP COLUMN "persistent",
    DROP COLUMN "keepStarter",
    ADD COLUMN "locationId" TEXT NOT NULL,
    ADD COLUMN "roomId" TEXT;
CREATE INDEX "PlayerThread_locationId_idx" ON "PlayerThread"("locationId");
ALTER TABLE "PlayerThread" ADD CONSTRAINT "PlayerThread_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerThread" ADD CONSTRAINT "PlayerThread_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Zone: the forums, #private, their anchors and the zone travel graph go.
ALTER TABLE "_ZoneConnections" DROP CONSTRAINT "_ZoneConnections_A_fkey";
ALTER TABLE "_ZoneConnections" DROP CONSTRAINT "_ZoneConnections_B_fkey";
DROP TABLE "_ZoneConnections";
ALTER TABLE "Zone"
    DROP COLUMN "discordPublicChannelId",
    DROP COLUMN "discordPrivateChannelId",
    DROP COLUMN "createTopicThreadId",
    DROP COLUMN "createTopicHash",
    DROP COLUMN "privateAnchorMessageId",
    DROP COLUMN "privateAnchorHash";

-- LocationTopic is replaced by Location + Room.
ALTER TABLE "LocationTopic" DROP CONSTRAINT "LocationTopic_zoneId_fkey";
DROP TABLE "LocationTopic";

DROP TYPE "PlayerThreadKind";
