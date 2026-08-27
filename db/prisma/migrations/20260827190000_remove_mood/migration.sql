-- Removes the Mood system entirely: the `happy` / `unhappy` Status tags and
-- everything holding them, plus the SET_MOOD RequestType value.
--
-- Mood was never a column (an earlier MoodState enum was already dropped in
-- 20260819230000_drop_mood_add_romance_optout), so this is tag rows and one
-- enum value. Hunger is now the only contributor to Action.diceModifier.
--
-- Postgres can't drop a single enum value in place, so RequestType is
-- recreated. Any surviving row still holding SET_MOOD would block that, so
-- those requests are deleted first. This is a deliberate loss of Set Mood
-- request history; the matching AuditLog rows are NOT touched, because
-- AuditLog.actionType is free text with no enum and /gm/audit filters it by
-- substring, so that history stays readable.

-- Anyone currently Happy or Unhappy simply stops being so.
DELETE FROM "CharacterTag"
  WHERE "tagId" IN (SELECT "id" FROM "Tag" WHERE "slug" IN ('happy', 'unhappy'));

DELETE FROM "Request" WHERE "type" = 'SET_MOOD';

-- consumesInto is a String[] of slugs with no foreign key, so nothing in the
-- database would stop `happy` from lingering there and pointing at a tag that
-- no longer exists. db/prisma/sync-tags.js rewrites these from docs/tags.yaml,
-- but that is a separate manual step -- doing it here keeps the catalog
-- consistent in the window between the migration and the next sync.
UPDATE "Tag" SET "consumesInto" = array_remove("consumesInto", 'happy')
  WHERE 'happy' = ANY("consumesInto");

-- Fine Meal was the only consumesIntoUnless user ({"happy": ["nobility"]}).
UPDATE "Tag" SET "consumesIntoUnless" = NULL WHERE "slug" = 'fine-meal';

DELETE FROM "Tag" WHERE "slug" IN ('happy', 'unhappy');

-- RequestType: drop SET_MOOD
ALTER TYPE "RequestType" RENAME TO "RequestType_old";
CREATE TYPE "RequestType" AS ENUM (
  'FULFILL_DESIRE',
  'ADD_TAG',
  'BUY_TAGS',
  'REMOVE_TAG',
  'CONSUME_TAG',
  'TRANSFER_RESOURCES',
  'TRANSFER_TAG',
  'DONATE_BLOOD',
  'FEED_PERSON',
  'HEAL_CHARACTER',
  'CHANGE_NAME'
);
ALTER TABLE "Request" ALTER COLUMN "type" TYPE "RequestType"
  USING ("type"::text::"RequestType");
DROP TYPE "RequestType_old";
