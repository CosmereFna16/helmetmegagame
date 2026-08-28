-- Drop the global-fallback summary channel: PUBLIC staged declarations now
-- require a zone and post to that zone's own #summary channel.
ALTER TABLE "GameConfig" DROP COLUMN IF EXISTS "turnSummaryChannelId";
