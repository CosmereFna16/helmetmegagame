-- Paperwork. See docs/systemdocs/PAPERWORK.md.

-- What a sheet currently is. Null on every ordinary tag, blank paper included.
CREATE TYPE "PaperKind" AS ENUM ('PAPER', 'SEALED', 'BROKEN_SEAL');

ALTER TABLE "Tag" ADD COLUMN "paperKind" "PaperKind";
ALTER TABLE "Tag" ADD COLUMN "paperText" TEXT;
ALTER TABLE "Tag" ADD COLUMN "paperAuthor" TEXT;
ALTER TABLE "Tag" ADD COLUMN "sealMark" TEXT;
ALTER TABLE "Tag" ADD COLUMN "ephemeral" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every crate already in the world is runtime-minted, and until now
-- nothing ever deleted one. Marking them here is what lets the first Restart
-- Game sweep up rows that have been accumulating since the Depot rework.
-- Headstones have no column of their own to match on and are left; they are
-- rare, and the minter sets the flag from here on.
UPDATE "Tag" SET "ephemeral" = true WHERE "crateContents" IS NOT NULL;

CREATE INDEX "Tag_ephemeral_idx" ON "Tag"("ephemeral");

-- The board itself.
CREATE TABLE "NoticePost" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "postedById" TEXT,
    "postedTurn" INTEGER NOT NULL,
    "expiresTurn" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticePost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NoticePost_tagId_key" ON "NoticePost"("tagId");
CREATE INDEX "NoticePost_locationId_idx" ON "NoticePost"("locationId");
CREATE INDEX "NoticePost_expiresTurn_idx" ON "NoticePost"("expiresTurn");

ALTER TABLE "NoticePost" ADD CONSTRAINT "NoticePost_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoticePost" ADD CONSTRAINT "NoticePost_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoticePost" ADD CONSTRAINT "NoticePost_postedById_fkey"
    FOREIGN KEY ("postedById") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- How long a notice stays up.
ALTER TABLE "GameConfig" ADD COLUMN "noticeExpiryTurns" INTEGER NOT NULL DEFAULT 10;

-- The Bird carries an object now, not a string. `body` survives as the GM's
-- snapshot of what went, and drops NOT NULL because a sealed letter's text is
-- not something the bird saw either.
ALTER TABLE "BirdMessage" ADD COLUMN "tagId" TEXT;
ALTER TABLE "BirdMessage" ADD COLUMN "tagName" TEXT;
ALTER TABLE "BirdMessage" ALTER COLUMN "body" DROP NOT NULL;

-- Breaking the wax on a sealed letter. Its own request type because it cannot
-- go through consumesInto, which names catalog slugs.
ALTER TYPE "RequestType" ADD VALUE 'BREAK_SEAL';
