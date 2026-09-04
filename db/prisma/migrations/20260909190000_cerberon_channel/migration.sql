-- The Watch became the Cerberon. The channel's id column moves with it: it is
-- an id, not a match key, so a plain rename is safe and it keeps
-- `grep -ri watch` honest.
ALTER TABLE "GameConfig" RENAME COLUMN "watchChannelId" TO "cerberonChannelId";
