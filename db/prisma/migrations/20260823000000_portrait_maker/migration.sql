-- The in-app portrait maker: two GM switches and the stored selection.
-- See docs/systemdocs/PORTRAITS.md.
ALTER TABLE "GameConfig" ADD COLUMN "portraitMakerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GameConfig" ADD COLUMN "portraitFantasyPartsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Part and palette indices as JSON, never pixels; the render itself stays in
-- Character.avatarData alongside an uploaded picture.
ALTER TABLE "Character" ADD COLUMN "portrait" TEXT;
