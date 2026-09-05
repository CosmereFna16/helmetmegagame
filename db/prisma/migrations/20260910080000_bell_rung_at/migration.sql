-- The Cathedral bell's five-minute cooldown. Nullable, so an existing row
-- needs no backfill: null simply means the rope has never been pulled.
ALTER TABLE "GameConfig" ADD COLUMN "bellRungAt" TIMESTAMP(3);
