-- The 20260818030241_add_radio_channel_config migration was recorded as
-- applied without actually adding radioRoleId (the migration.sql on disk
-- was edited after it ran), leaving GameConfig.radioRoleId missing from the
-- live database and crashing every advanceTurn() call. Add it directly.
ALTER TABLE "GameConfig" ADD COLUMN IF NOT EXISTS "radioRoleId" TEXT;
