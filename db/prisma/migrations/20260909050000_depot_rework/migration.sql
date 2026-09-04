-- The Merchant's Depot rework: the station becomes a machine with a
-- generator, a shuttle, a turret and a bank account, and its money becomes
-- obols rather than Resources. See docs/systemdocs/DEPOT.md.

-- Where the shuttle is.
CREATE TYPE "ShuttleState" AS ENUM ('AWAY', 'INBOUND', 'DOCKED');

-- Five new request kinds, all obol-denominated.
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_ORDER';
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_SHIP';
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_ATM';
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_CRATE_OPEN';
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_REFUEL';

-- A ware that ships sealed: no manifest printed, and only a Depot Keycard
-- opens the crate it lands in.
ALTER TABLE "Tag" ADD COLUMN "sealedShipping" BOOLEAN NOT NULL DEFAULT false;

-- The credit line moves off the Merchant and onto the station, because the
-- licence is tradeable and the money should travel with it. Pre-launch, so
-- there is nothing to carry across.
ALTER TABLE "Character" DROP COLUMN "depotDebt";

-- The station itself. One row, id = 1.
CREATE TABLE "Depot" (
    "id" INTEGER NOT NULL DEFAULT 1,

    "accountObols" INTEGER NOT NULL DEFAULT 0,
    "debtObols" INTEGER NOT NULL DEFAULT 0,

    "generatorOn" BOOLEAN NOT NULL DEFAULT false,
    "generatorFuel" INTEGER NOT NULL DEFAULT 0,

    "turretArmed" BOOLEAN NOT NULL DEFAULT false,
    "merchantFace" TEXT NOT NULL DEFAULT '',

    "shuttleState" "ShuttleState" NOT NULL DEFAULT 'AWAY',
    "shuttleTurn" INTEGER,

    "manifest" JSONB NOT NULL DEFAULT '[]',

    "fuelMax" INTEGER NOT NULL DEFAULT 100,
    "fuelBurnPerTurn" INTEGER NOT NULL DEFAULT 20,
    "coalFuel" INTEGER NOT NULL DEFAULT 50,
    "saltpeterFuel" INTEGER NOT NULL DEFAULT 15,

    "shuttleMaxTurns" INTEGER NOT NULL DEFAULT 6,
    "shuttleCooldown" INTEGER NOT NULL DEFAULT 1,

    "creditCapObols" INTEGER NOT NULL DEFAULT 60,
    "obolRate" INTEGER NOT NULL DEFAULT 5,

    "turretTable" JSONB NOT NULL DEFAULT '{}',

    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("id")
);

-- What falls out of a runtime crate tag when it is opened.
ALTER TABLE "Tag" ADD COLUMN "crateContents" JSONB;
