-- AlterEnum
ALTER TYPE "ActionStatus" ADD VALUE 'PENDING_OPPOSED';

-- CreateEnum
CREATE TYPE "MoveKind" AS ENUM ('ROUTINE', 'GAMBIT');

-- CreateEnum
CREATE TYPE "MoveReviewStatus" AS ENUM ('OPEN', 'WAITING_FOR_OPPONENTS', 'IN_PROGRESS', 'SOLVED');

-- AlterTable
ALTER TABLE "Action" DROP COLUMN "isPublic",
ADD COLUMN     "moveKind" "MoveKind",
ADD COLUMN     "opposed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moveReviewStatus" "MoveReviewStatus" NOT NULL DEFAULT 'OPEN';

-- Existing ADJUDICATED rows are already-resolved history under the old
-- flow; surface them as SOLVED in the new GM spreadsheet view.
UPDATE "Action" SET "moveReviewStatus" = 'SOLVED' WHERE "status" = 'ADJUDICATED';
