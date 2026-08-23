-- GM-authored tags, created at /gm/dev/tags rather than declared in
-- docs/tags.yaml. syncTags.js is keyed by slug and upsert-only, so it never
-- touches these rows; db:prune-tags, which is destructive, skips them.
--
-- NOT NULL DEFAULT false is a catalog-only change on Postgres 11+, so this
-- adds no table rewrite even though every existing tag gets the column.
ALTER TABLE "Tag" ADD COLUMN "custom" BOOLEAN NOT NULL DEFAULT false;
