-- Master switch for player avatar uploads, off by default.
ALTER TABLE "GameConfig" ADD COLUMN "avatarUploadsEnabled" BOOLEAN NOT NULL DEFAULT false;
