-- CreateTable
CREATE TABLE "_ZoneConnections" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ZoneConnections_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ZoneConnections_B_index" ON "_ZoneConnections"("B");

-- AddForeignKey
ALTER TABLE "_ZoneConnections" ADD CONSTRAINT "_ZoneConnections_A_fkey" FOREIGN KEY ("A") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ZoneConnections" ADD CONSTRAINT "_ZoneConnections_B_fkey" FOREIGN KEY ("B") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
