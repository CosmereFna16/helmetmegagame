-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "stackable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CharacterTag" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;
