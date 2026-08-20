-- DropForeignKey
ALTER TABLE "_ZoneConnections" DROP CONSTRAINT "_ZoneConnections_A_fkey";

-- DropForeignKey
ALTER TABLE "_ZoneConnections" DROP CONSTRAINT "_ZoneConnections_B_fkey";

-- DropTable
DROP TABLE "_ZoneConnections";

-- CreateTable
CREATE TABLE "_LocationConnections" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LocationConnections_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_LocationConnections_B_index" ON "_LocationConnections"("B");

-- AddForeignKey
ALTER TABLE "_LocationConnections" ADD CONSTRAINT "_LocationConnections_A_fkey" FOREIGN KEY ("A") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationConnections" ADD CONSTRAINT "_LocationConnections_B_fkey" FOREIGN KEY ("B") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
