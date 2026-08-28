-- Thread expiry is no longer a tunable GameConfig setting. It's hardcoded
-- to THREAD_EXPIRY_TURNS in db/lib/threadExpiryPass.js and always runs.
ALTER TABLE "GameConfig" DROP COLUMN "threadExpiryEnabled",
DROP COLUMN "threadExpiryTurns";
