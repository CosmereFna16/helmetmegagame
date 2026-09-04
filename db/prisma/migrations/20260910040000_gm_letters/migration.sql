-- GM letters ride the BirdMessage row, which buys the reply window, the
-- one-reply claim and the letter transfer for free. Three columns loosen so a
-- letter can come from nobody in particular: a GM types the name it arrives
-- under, and there is no zone guess because a GM already knows where everyone
-- is standing.
ALTER TABLE "BirdMessage" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "BirdMessage" ALTER COLUMN "guessedZoneId" DROP NOT NULL;
ALTER TABLE "BirdMessage" ALTER COLUMN "guessedZoneName" DROP NOT NULL;
ALTER TABLE "BirdMessage" ADD COLUMN "gmSenderDiscordUserId" TEXT;
