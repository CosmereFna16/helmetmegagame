-- Map panel node coordinates, mastered by `map:` in docs/locations.yaml.
ALTER TABLE "Location" ADD COLUMN "mapX" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN "mapY" DOUBLE PRECISION;
