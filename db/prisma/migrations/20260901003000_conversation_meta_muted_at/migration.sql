-- A GM-side mute on a player-desk conversation. Desk-side only: nothing about
-- the bot's behaviour toward the player changes. Unlike "handledAt" it does
-- not expire — it holds until a GM unmutes.
ALTER TABLE "ConversationMeta" ADD COLUMN "mutedAt" TIMESTAMP(3);
