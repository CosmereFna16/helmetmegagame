-- A Room may carry a live line in its starter message: a key from the registry
-- in db/lib/roomLive.js, re-rendered whenever the state it reads moves.
ALTER TABLE "Room" ADD COLUMN "live" TEXT;
