-- A creation-wizard-in-progress hold on a Role seat, so a capacity-1 role
-- can't be pulled out from under a player mid-wizard. Purely additive: a
-- new table and its indexes, nothing altered or dropped.
CREATE TABLE "RoleReservation" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoleReservation_discordUserId_key" ON "RoleReservation"("discordUserId");

CREATE INDEX "RoleReservation_roleId_expiresAt_idx" ON "RoleReservation"("roleId", "expiresAt");

ALTER TABLE "RoleReservation" ADD CONSTRAINT "RoleReservation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
