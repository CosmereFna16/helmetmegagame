-- Action.locationId: where a Move was filed from.
--
-- Action.zoneId was not enough. A free zone move (docs/systemdocs/CARRY.md
-- §2a) costs no Action, so a character can file a Labor on the Godard Factory
-- floor and walk out before the turn closes — and a Labor's payout runs at
-- turn close. db/lib/moveEffects.js#refined was asking where the character is
-- standing NOW, which paid a refining shift to somebody who had left and paid
-- nothing to somebody who had arrived.
--
-- Nullable and SET NULL: rows filed before this existed fall back to the live
-- location, and pruning a Location with db:sync-zones must not delete history.
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

ALTER TABLE "Action" DROP CONSTRAINT IF EXISTS "Action_locationId_fkey";
ALTER TABLE "Action" ADD CONSTRAINT "Action_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Action_locationId_idx" ON "Action"("locationId");
