-- The players desk's message-content search (gm/players/actions.js#searchConversations)
-- is an ILIKE '%term%' over DirectMessage.content. A btree can't serve that; the
-- archive already carries the same trigram index for /archive search
-- (20260825020000_launch_hardening_indexes), so pg_trgm is already installed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "DirectMessage_content_trgm_idx" ON "DirectMessage" USING GIN ("content" gin_trgm_ops);
