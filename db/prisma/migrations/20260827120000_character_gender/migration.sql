-- How a character presents, as a real column rather than something inferred
-- from their title. It decides which word of a gendered title they wear (a Man
-- holding Nobility is Lord, a Woman is Lady, Neutral is Noble) and it is the
-- Man/Woman/Person half of a concealed alias.
--
-- Both columns are additive and either defaulted or nullable, so the currently
-- deployed build ignores them until the new one takes traffic. Postgres
-- backfills every existing Character row from the DEFAULT.
--
-- No CHECK constraint anywhere: validity is enforced in the server actions, so
-- a GM correction is never blocked by the database.

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MAN', 'WOMAN', 'NEUTRAL');

-- AlterTable
-- NEUTRAL for existing rows: the game is pre-launch, and it is the reading
-- that claims least about a character nobody asked.
ALTER TABLE "Character" ADD COLUMN     "gender" "Gender" NOT NULL DEFAULT 'NEUTRAL';

-- AlterTable
-- Null for every ordinary seat; set only on baron/baroness/heir/successor,
-- from `gender:` in docs/roles.yaml via db:sync-roles.
ALTER TABLE "Role" ADD COLUMN     "lockedGender" "Gender";
