-- Concealment becomes a property of gear rather than a free toggle.
--
-- Tag.concealsIdentity already existed and was deliberately inert; this
-- migration adds the three things it needed to actually work: a way to say the
-- wearer gets no choice, the avatar the room sees instead of their face, and
-- the slot/layer pair that decides which of two hats wins.
--
-- Everything is nullable or defaulted, so no backfill: a catalog row acquires
-- these on the next `npm run db:sync-tags`, and a character wearing nothing
-- concealing simply resolves to their own face as before.

-- HEAD/BODY carry a layer 1-4; SHIELD admits exactly one and carries none.
CREATE TYPE "EquipSlot" AS ENUM ('HEAD', 'BODY', 'SHIELD');

ALTER TABLE "Tag"
  ADD COLUMN "forcesConceal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "concealSprite" TEXT,
  ADD COLUMN "equipSlot"     "EquipSlot",
  ADD COLUMN "equipLayer"    INTEGER;
