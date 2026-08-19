-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "isTreasurer" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "defaultDurationTurns" INTEGER,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "purchasable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchasableAfterStart" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requiredTagId" TEXT,
ADD COLUMN     "tradeable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TagGroup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "color" TEXT,
    "requiredTagId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagGroup_slug_key" ON "TagGroup"("slug");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_requiredTagId_fkey" FOREIGN KEY ("requiredTagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagGroup" ADD CONSTRAINT "TagGroup_requiredTagId_fkey" FOREIGN KEY ("requiredTagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
