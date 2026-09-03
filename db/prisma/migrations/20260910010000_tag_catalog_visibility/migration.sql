-- Who may see a tag in the /documents Tag Catalog: SECRET (nobody, GMs
-- included), GM (GMs, plus players whose character relates to it), ALL
-- (fully public). Authored as `catalog:` in docs/tags.yaml, required on
-- every entry. Default GM so rows the sync never touches (GM-authored tags,
-- minted headstones) can never land fully public by omission.
CREATE TYPE "CatalogVisibility" AS ENUM ('SECRET', 'GM', 'ALL');

ALTER TABLE "Tag" ADD COLUMN "catalogVisibility" "CatalogVisibility" NOT NULL DEFAULT 'GM';

-- The archived Cult of Bacchus (docs/archive/bacchus.yaml) is out of
-- docs/tags.yaml, so the sync will never stamp these rows — but they survive
-- in any database the sync ran against while the cult was live, and they are
-- antagonist content. Mark them SECRET here so no DB shows them.
UPDATE "Tag"
SET "catalogVisibility" = 'SECRET'
WHERE "slug" IN ('cult-leader', 'follower-of-bacchus')
   OR "groupId" IN (SELECT "id" FROM "TagGroup" WHERE "slug" = 'meta-cult');
