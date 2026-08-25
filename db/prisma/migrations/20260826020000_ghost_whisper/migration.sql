-- The 12-hour, per-ghost cooldown behind the wind reaction
-- (db/lib/ghostWhisper.js).
--
-- Keyed on the Discord user rather than a character: a ghost's character is
-- dead by definition, and they may be between characters entirely. Persisted
-- rather than held in memory because 12 real hours outlives a bot process --
-- an in-memory cooldown would read as "ready" after every deploy.
CREATE TABLE "GhostWhisper" (
    "discordUserId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhostWhisper_pkey" PRIMARY KEY ("discordUserId")
);
