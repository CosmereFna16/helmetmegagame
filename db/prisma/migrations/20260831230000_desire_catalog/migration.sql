-- The Desire catalog: DesireTemplate is master-sourced from docs/desires.yaml
-- (db/lib/syncDesires.js, a later task). Desire itself is extended in place
-- rather than replaced — see engineering-plan.md §0 — so every existing
-- reader of Desire.text/points keeps working untouched.

-- CreateTable
CREATE TABLE "DesireTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tier" INTEGER NOT NULL,
    "families" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onceEver" BOOLEAN NOT NULL DEFAULT false,
    "cooldownTurns" INTEGER,
    "requiresAnyRoleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresNotRoleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DesireTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesireTemplate_slug_key" ON "DesireTemplate"("slug");

-- AlterTable
ALTER TABLE "Desire" ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "slotIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Desire_characterId_templateId_status_idx" ON "Desire"("characterId", "templateId", "status");

-- AddForeignKey
ALTER TABLE "Desire" ADD CONSTRAINT "Desire_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DesireTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "desireSlots" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "_DesireRequiresAnyTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DesireRequiresAnyTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DesireRequiresAnyTag_B_index" ON "_DesireRequiresAnyTag"("B");

-- CreateTable
CREATE TABLE "_DesireForbidsTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DesireForbidsTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DesireForbidsTag_B_index" ON "_DesireForbidsTag"("B");

-- AddForeignKey
ALTER TABLE "_DesireRequiresAnyTag" ADD CONSTRAINT "_DesireRequiresAnyTag_A_fkey" FOREIGN KEY ("A") REFERENCES "DesireTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesireRequiresAnyTag" ADD CONSTRAINT "_DesireRequiresAnyTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesireForbidsTag" ADD CONSTRAINT "_DesireForbidsTag_A_fkey" FOREIGN KEY ("A") REFERENCES "DesireTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesireForbidsTag" ADD CONSTRAINT "_DesireForbidsTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
