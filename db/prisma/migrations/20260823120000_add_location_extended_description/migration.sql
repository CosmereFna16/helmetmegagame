-- Long-form location prose, plus the bookkeeping for the generated
-- "{Location}: Description" forum post that carries it.
ALTER TABLE "Location"
ADD COLUMN     "extendedDescription" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "discordDescriptionThreadId" TEXT,
ADD COLUMN     "descriptionPostHash" TEXT;

-- publicSubLocations: TEXT[] of names -> JSONB of [{ name, description }].
-- Dropped and re-added rather than cast, deliberately: docs/locations.yaml is
-- the sole master for this column and the very next `npm run db:sync-locations`
-- rewrites it for every row, so a cast would preserve data that is about to be
-- overwritten anyway. privateSubLocations is untouched — nothing reads it yet.
ALTER TABLE "Location" DROP COLUMN "publicSubLocations";
ALTER TABLE "Location" ADD COLUMN "publicSubLocations" JSONB NOT NULL DEFAULT '[]';
