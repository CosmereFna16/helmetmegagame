-- Location attributes: the authored, sparse facts about a place, rendered by
-- the Examine button on its anchor. Keys are validated against the registry in
-- db/lib/locationAttributes.js at sync time.
--
-- Additive with a default, so `migrate deploy` applies it against a live table
-- without a rewrite and older code that never selects the column is unaffected.
ALTER TABLE "Location" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';
