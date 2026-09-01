-- The "no reply needed" mark on a GM player-desk conversation. Nullable and
-- desk-wide, like the advisory claim beside it; it self-expires against the
-- conversation's last message, so nothing ever has to clear it.
ALTER TABLE "ConversationMeta" ADD COLUMN "handledAt" TIMESTAMP(3);
