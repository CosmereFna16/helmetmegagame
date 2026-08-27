-- Removes the Fear mechanic entirely: the three Character columns, the
-- CHANGE_FEAR/FULFILL_FEAR RequestType values, and the FEAR_FULFILLED
-- ArchiveKind value.
--
-- Postgres can't drop a single enum value in place, so both enums are
-- recreated. Any existing row still holding a removed value would block
-- that recreation, so historical rows of those kinds are deleted first.
-- This is a deliberate loss of Fear-related request/archive history.

DELETE FROM "Request" WHERE "type" IN ('CHANGE_FEAR', 'FULFILL_FEAR');
DELETE FROM "ArchiveEntry" WHERE "kind" = 'FEAR_FULFILLED';

-- Character.fear / fearSetTurnNumber / fearLastFulfilledTurn
ALTER TABLE "Character" DROP COLUMN "fear",
                        DROP COLUMN "fearSetTurnNumber",
                        DROP COLUMN "fearLastFulfilledTurn";

-- RequestType: drop CHANGE_FEAR, FULFILL_FEAR
ALTER TYPE "RequestType" RENAME TO "RequestType_old";
CREATE TYPE "RequestType" AS ENUM (
  'FULFILL_DESIRE',
  'ADD_TAG',
  'BUY_TAGS',
  'REMOVE_TAG',
  'CONSUME_TAG',
  'TRANSFER_RESOURCES',
  'TRANSFER_TAG',
  'SET_MOOD',
  'DONATE_BLOOD',
  'FEED_PERSON',
  'HEAL_CHARACTER',
  'CHANGE_NAME'
);
ALTER TABLE "Request" ALTER COLUMN "type" TYPE "RequestType"
  USING ("type"::text::"RequestType");
DROP TYPE "RequestType_old";

-- ArchiveKind: drop FEAR_FULFILLED. The column has a default, which has to
-- be dropped and re-added around the type swap.
ALTER TABLE "ArchiveEntry" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TYPE "ArchiveKind" RENAME TO "ArchiveKind_old";
CREATE TYPE "ArchiveKind" AS ENUM (
  'MESSAGE',
  'TURN_START',
  'CHARACTER_CREATED',
  'DEATH',
  'DESIRE_FULFILLED',
  'LIFEWEB',
  'TRAVEL'
);
ALTER TABLE "ArchiveEntry" ALTER COLUMN "kind" TYPE "ArchiveKind"
  USING ("kind"::text::"ArchiveKind");
ALTER TABLE "ArchiveEntry" ALTER COLUMN "kind" SET DEFAULT 'MESSAGE';
DROP TYPE "ArchiveKind_old";
