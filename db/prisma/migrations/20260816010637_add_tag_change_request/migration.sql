-- CreateEnum
CREATE TYPE "TagChangeRequestStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "TagChangeRequest" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "requestedByDiscordUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TagChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultMessage" TEXT,
    "gmNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TagChangeRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TagChangeRequest" ADD CONSTRAINT "TagChangeRequest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
