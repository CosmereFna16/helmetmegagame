-- Persist the Discord REST circuit breaker across restarts.
--
-- The counters lived in module-level JS, so a crash-restart loop -- the one
-- scenario the breaker exists for -- zeroed them on every iteration while
-- Cloudflare's own count, keyed on the egress IP, carried on. Sharing them
-- here also means the bot and web containers stop counting separate fractions
-- of the traffic hitting one IP against a whole-IP ceiling.
ALTER TABLE "GameConfig" ADD COLUMN "restInvalidCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GameConfig" ADD COLUMN "restInvalidWindowStart" TIMESTAMP(3);
ALTER TABLE "GameConfig" ADD COLUMN "restBreakerOpenUntil" TIMESTAMP(3);

-- The resume lease. needsResolvedAt is the completion stamp, written at the
-- end; a lease has to be taken at the start, so it cannot double as one.
-- Without it the bot's cron and a GM's End turn could both resume the same
-- crashed turn and run every outstanding pass twice.
ALTER TABLE "Turn" ADD COLUMN "needsResumeClaimedAt" TIMESTAMP(3);
