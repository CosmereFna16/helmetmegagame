-- Typed connections, and the end of the per-Location Discord role.
--
-- Two things happen here, both part of the Bascinet 2 map rebuild.
--
-- 1. Location.discordRoleId goes away. A Location channel is now opened to
--    whoever stands in it by a per-member permission overwrite instead of a
--    "Location: {Name}" role. 56 locations would have cost 56 of the guild's
--    250 roles on top of one personal role per living character; Discord
--    allows 1000 overwrites per channel.
--
--    The Discord roles themselves are deleted by
--    `npm run db:prune-stale-channels -- --apply`, which can run either side
--    of this migration: it matches "Location: " roles by NAME against the set
--    the DB still claims, and since nothing claims any of them any more, all
--    of them are stale. Running it is a separate step; this migration only
--    forgets the ids.
--
-- 2. The implicit _LocationConnections join table becomes the explicit
--    LocationLink model, so an edge can carry a type. No backfill: the graph
--    is repopulated wholesale from docs/zones.yaml by the next
--    `npm run db:sync-zones`, which is where the new map lands.

-- CreateEnum
CREATE TYPE "LinkAnnounce" AS ENUM ('NONE', 'TRUE_NAME', 'CONCEALED');

-- DropIndex
DROP INDEX "Location_discordRoleId_key";

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "discordRoleId";

-- DropForeignKey
ALTER TABLE "_LocationConnections" DROP CONSTRAINT "_LocationConnections_A_fkey";

-- DropForeignKey
ALTER TABLE "_LocationConnections" DROP CONSTRAINT "_LocationConnections_B_fkey";

-- DropTable
DROP TABLE "_LocationConnections";

-- CreateTable
CREATE TABLE "LocationLink" (
    "id" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "announce" "LinkAnnounce" NOT NULL DEFAULT 'NONE',
    "requiredTagSlug" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "modular" BOOLEAN NOT NULL DEFAULT false,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openerRoleSlugs" TEXT[],
    "openerTagSlugs" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationLink_bId_idx" ON "LocationLink"("bId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationLink_aId_bId_key" ON "LocationLink"("aId", "bId");

-- AddForeignKey
ALTER TABLE "LocationLink" ADD CONSTRAINT "LocationLink_aId_fkey" FOREIGN KEY ("aId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationLink" ADD CONSTRAINT "LocationLink_bId_fkey" FOREIGN KEY ("bId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
