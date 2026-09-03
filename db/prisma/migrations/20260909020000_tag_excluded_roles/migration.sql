-- Role slugs that may not buy a tag (docs/tags.yaml `excludedRoles:`).
ALTER TABLE "Tag" ADD COLUMN "excludedRoleSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
