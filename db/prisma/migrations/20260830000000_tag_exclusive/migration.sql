-- Additive: at most one `exclusive` tag per character (the Beliefs).
-- Default false, so every existing row keeps its current behaviour and
-- db:sync-tags sets the flag on the nine belief tags.
ALTER TABLE "Tag" ADD COLUMN "exclusive" BOOLEAN NOT NULL DEFAULT false;
