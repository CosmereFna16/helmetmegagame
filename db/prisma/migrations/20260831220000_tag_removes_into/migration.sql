-- Tag.removesInto: the treated-wound aftermath chain, granted when a tag
-- leaves the sheet through a player-driven removal (Remove Tag / Heal).
ALTER TABLE "Tag" ADD COLUMN "removesInto" JSONB;
