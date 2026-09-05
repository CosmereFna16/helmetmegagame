-- Two armour values per tag, 0.0-1.0. Nullable: most of the catalog is skills,
-- statuses and beliefs, which turn nothing aside.
--
-- ballisticArmor replaces the hardcoded slug ladder that used to live in
-- db/lib/depotTurret.js, which knew about seven body-armour slugs and nothing
-- about any helmet, shield or the spacesuit. meleeArmor is authored now and
-- read by nothing yet; see the schema comment.
ALTER TABLE "Tag" ADD COLUMN "meleeArmor" DOUBLE PRECISION;
ALTER TABLE "Tag" ADD COLUMN "ballisticArmor" DOUBLE PRECISION;
