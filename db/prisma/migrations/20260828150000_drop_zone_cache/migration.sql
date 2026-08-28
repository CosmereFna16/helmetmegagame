-- The zone cache is gone. Putting an Item down for anyone in the zone to pick
-- up was too fiddly to keep correct: the drop/pick-up race handling was
-- awkward, and db/lib/pruneTags.js never learned to treat a ZoneCache row as
-- a reason a Tag must survive, so a prune could delete a tag that was lying
-- on the ground and cascade the cache row away with it.
--
-- Both FKs on this table are ON DELETE CASCADE and nothing else references
-- it, so the table drops clean.
DROP TABLE "ZoneCache";

-- The DROP_ITEM / PICK_UP_ITEM / CREATE_TAG values stay in "RequestType".
-- Postgres cannot drop an enum value in place, and any Request row filed
-- before this removal still carries one. Nothing writes them any more; see
-- the retired block in schema.prisma.
