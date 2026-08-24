-- The #location channel and its ⚜ travel picker were retired; the Travel,
-- Move and Speak buttons now live on one anchor message in #turns. These two
-- columns hold exactly the same thing for exactly the same reason, so they
-- are renamed rather than dropped and re-added — a rename keeps whatever
-- message id is already stored, so an existing deploy re-adopts its anchor
-- instead of posting a second one.
ALTER TABLE "GameConfig" RENAME COLUMN "locationPromptChannelId" TO "turnsConsoleChannelId";
ALTER TABLE "GameConfig" RENAME COLUMN "locationPromptMessageId" TO "turnsConsoleMessageId";
