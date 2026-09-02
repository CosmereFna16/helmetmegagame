-- Desires: `requires.allTags` (2026-09-02).
--
-- A gate that needs EVERY listed tag, not any one of them — "Butcher a human"
-- wants Cruel AND Butcher. A real m2m relation rather than a slug array so
-- db:prune-tags can see the reference and refuse to delete a Tag a live
-- desire depends on, matching _DesireRequiresAnyTag / _DesireForbidsTag.

-- CreateTable
CREATE TABLE "_DesireRequiresAllTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DesireRequiresAllTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_DesireRequiresAllTag_B_index" ON "_DesireRequiresAllTag"("B");

-- AddForeignKey
ALTER TABLE "_DesireRequiresAllTag" ADD CONSTRAINT "_DesireRequiresAllTag_A_fkey" FOREIGN KEY ("A") REFERENCES "DesireTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesireRequiresAllTag" ADD CONSTRAINT "_DesireRequiresAllTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
