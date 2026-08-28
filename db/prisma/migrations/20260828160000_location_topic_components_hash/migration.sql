-- Tracks the starter message's button row separately from its body (postHash).
-- syncTopicPost uses this to detect a components-only change (e.g. the new
-- "Who's here?" button) and take a cheap starter-edit path instead of the
-- full rewriteForumPost rebuild, which would otherwise delete every reply in
-- the post — the day's roleplay — just to add a button.
ALTER TABLE "LocationTopic" ADD COLUMN "componentsHash" TEXT;
