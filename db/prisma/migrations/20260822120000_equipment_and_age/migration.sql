-- Equipment, concealed identity, and character age.
--
-- Every column here is additive and either nullable or defaulted, so the
-- currently-deployed code ignores them until the new build takes traffic.

-- Catalog flags. `concealsIdentity` is only meaningful alongside `equippable`;
-- db/lib/syncTags.js enforces that pairing at sync time.
ALTER TABLE "Tag"
  ADD COLUMN "equippable"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "concealsIdentity" BOOLEAN NOT NULL DEFAULT false;

-- Per-character equipped state. Capped by GameConfig.equipSlots in the server
-- action, not by a constraint: the cap is configurable and a CHECK cannot see
-- across rows.
ALTER TABLE "CharacterTag"
  ADD COLUMN "equipped" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GameConfig"
  ADD COLUMN "equipSlots" INTEGER NOT NULL DEFAULT 6;

-- Null until the player sets one; 18-90 is enforced in the server actions
-- rather than as a CHECK, so a GM correction is never blocked by the database.
ALTER TABLE "Character"
  ADD COLUMN "age" INTEGER;
