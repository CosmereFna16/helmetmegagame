-- The gun on the rotor in the fortress yard, which the Baron's charter has
-- described as "off" since before anything could switch it on. Off by default,
-- which keeps that line true until somebody presses the button.
ALTER TABLE "GameConfig" ADD COLUMN "gatehouseTurretArmed" BOOLEAN NOT NULL DEFAULT false;
