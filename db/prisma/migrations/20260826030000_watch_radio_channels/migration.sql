-- Rename the narrowcast "radio" channel to "watch" and add a shared
-- Discord category id. The old #radio channel is deleted out-of-band; the
-- new #watch channel is provisioned by db:sync-narrowcast-channels.
ALTER TABLE "GameConfig" DROP COLUMN "radioChannelId";
ALTER TABLE "GameConfig" ADD COLUMN "radioCategoryId" TEXT;
ALTER TABLE "GameConfig" ADD COLUMN "watchChannelId" TEXT;
