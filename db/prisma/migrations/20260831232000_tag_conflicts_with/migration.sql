-- Tag.conflictsWith / conflictedBy: pairwise cross-group incompatibility
-- ("this Addiction and that Restriction cannot coexist"), written in BOTH
-- directions by db:sync-tags so a caller only ever has to check one side.
-- Self-referential implicit m2m — same shape as _TagRequirementSkill.

-- CreateTable
CREATE TABLE "_TagConflicts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TagConflicts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TagConflicts_B_index" ON "_TagConflicts"("B");

-- AddForeignKey
ALTER TABLE "_TagConflicts" ADD CONSTRAINT "_TagConflicts_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagConflicts" ADD CONSTRAINT "_TagConflicts_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
