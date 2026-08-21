-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "consumable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consumeGrants" TEXT[];

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "tagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "factionSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_key_key" ON "Document"("key");
