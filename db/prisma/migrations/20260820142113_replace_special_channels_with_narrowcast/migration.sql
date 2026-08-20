-- DropForeignKey
ALTER TABLE "SpecialChannel" DROP CONSTRAINT "SpecialChannel_sendTagId_fkey";

-- DropForeignKey
ALTER TABLE "SpecialChannel" DROP CONSTRAINT "SpecialChannel_viewTagId_fkey";

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "intercomChannelId" TEXT,
ADD COLUMN     "radioChannelId" TEXT;

-- DropTable
DROP TABLE "SpecialChannel";

