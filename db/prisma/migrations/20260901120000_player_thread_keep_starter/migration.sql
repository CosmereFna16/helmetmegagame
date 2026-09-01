-- The Quest tier: a GM's hand-made forum post, re-authored as the bot
-- (bot/src/lib/questPost.js). Implies `persistent`; where a persistent post is
-- emptied at Dawn, a keepStarter post keeps its starter message and loses only
-- its replies. Written by hand rather than by `prisma migrate dev`, which
-- wanted to bundle in the unrelated, pre-existing `Action.opposed` drop.
ALTER TABLE "PlayerThread" ADD COLUMN "keepStarter" BOOLEAN NOT NULL DEFAULT false;
