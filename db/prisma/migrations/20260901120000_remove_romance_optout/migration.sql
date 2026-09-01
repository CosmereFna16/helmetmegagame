-- Removes the Disable Romance system entirely: the `romanceOptOut` column on
-- Character, the `romance-disabled` Meta tag that mirrored it, and every
-- CharacterTag row holding that tag.
--
-- The preference itself is a deliberate loss -- nothing replaces it, and no
-- other code read the column. The matching Discord `no-romance` role is guild
-- state rather than database state, so it is deleted by hand along with the
-- DISCORD_NO_ROMANCE_ROLE_ID variable; nothing reads either once this lands.

-- Anyone currently marked Romance Disabled simply stops being so.
DELETE FROM "CharacterTag"
  WHERE "tagId" IN (SELECT "id" FROM "Tag" WHERE "slug" = 'romance-disabled');

-- consumesInto is a String[] of slugs with no foreign key, so nothing in the
-- database would stop `romance-disabled` from lingering there and pointing at
-- a tag that no longer exists. db/prisma/sync-tags.js rewrites these from
-- docs/tags.yaml, but that is a separate manual step -- doing it here keeps the
-- catalog consistent in the window between the migration and the next sync.
UPDATE "Tag" SET "consumesInto" = array_remove("consumesInto", 'romance-disabled')
  WHERE 'romance-disabled' = ANY("consumesInto");

DELETE FROM "Tag" WHERE "slug" = 'romance-disabled';

ALTER TABLE "Character" DROP COLUMN "romanceOptOut";
