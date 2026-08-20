-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "tupperAutocorrectEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "craftable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "removable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requirementGambit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requirementResources" INTEGER,
ADD COLUMN     "requirementTurns" INTEGER;

-- CreateTable
CREATE TABLE "_TagRequirementSkill" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TagRequirementSkill_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TagRequirementSkill_B_index" ON "_TagRequirementSkill"("B");

-- AddForeignKey
ALTER TABLE "_TagRequirementSkill" ADD CONSTRAINT "_TagRequirementSkill_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagRequirementSkill" ADD CONSTRAINT "_TagRequirementSkill_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
