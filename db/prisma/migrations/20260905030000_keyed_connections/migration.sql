-- Keyed connections: hold the door for the next 24 hours.
--
-- A keyed edge DMs whoever crossed it with the key "Leave open for the next 24
-- hours?". Yes stamps openUntil, and while that stands the edge ignores its
-- required tag and shows up in everyone's travel list even though it is
-- hidden — which is the whole point, since it is how somebody without the key
-- follows you through.
--
-- Nothing has to close it again. crossingCheck compares openUntil against the
-- clock, so the window lapses on its own with no pass, no cron and no row to
-- clean up.

-- AlterTable
ALTER TABLE "LocationLink" ADD COLUMN     "keyed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openUntil" TIMESTAMP(3);
