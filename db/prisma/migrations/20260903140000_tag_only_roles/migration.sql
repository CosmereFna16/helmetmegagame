-- Tag.onlyRoleSlugs: the whitelist mirror of excludedRoleSlugs.
--
-- Empty means "open to every seat", so the default is permissive and no
-- existing row changes meaning.
ALTER TABLE "Tag" ADD COLUMN "onlyRoleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
