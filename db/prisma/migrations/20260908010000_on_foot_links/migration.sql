-- On-foot ways: a connection no horse or cart fits through.
--
-- Location.indoors already parks a mount, but it does so on ARRIVAL, and by
-- then the rider has already spent the extra free zone-crossing an equipped
-- mount buys. A secret passage into the Fortress was therefore rideable. This
-- column moves the refusal to the threshold, where it actually stops that.

-- AlterTable
ALTER TABLE "LocationLink" ADD COLUMN "onFoot" BOOLEAN NOT NULL DEFAULT false;
