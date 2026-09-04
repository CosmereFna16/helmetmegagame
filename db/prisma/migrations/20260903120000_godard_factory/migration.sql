-- Room.destroysContents: a room that eats what is put into it. Authored as
-- `destroys: true` in docs/zones.yaml; the Godard Factory's Spillway is the
-- only one. See docs/systemdocs/CARRY.md and docs/systemdocs/FACTORY.md.
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "destroysContents" BOOLEAN NOT NULL DEFAULT false;

-- Two new player-filed request kinds: cutting Godflesh out of the marsh, and
-- packing goods into a crate. See docs/systemdocs/FACTORY.md.
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'EXTRACT_GODFLESH';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'PACKAGE_ITEMS';

-- The obol rescale, guarded.
--
-- This file's name sorts BEFORE 20260909050000_depot_rework, which is what
-- creates the Depot table — the repo's migration timestamps run ahead of the
-- calendar, and this one was authored with today's real date. `migrate deploy`
-- applied it to the live database because it was simply the one new file, but
-- a REPLAY from empty runs these before Depot exists. So every Depot statement
-- here is wrapped in a check rather than moved: renaming the directory would
-- break the checksummed row in _prisma_migrations (see CLAUDE.md).
--
-- On a replay the block is skipped entirely, which is correct — a fresh Depot
-- is seeded at parity by 20260909110000_obol_parity and its account starts at
-- 0, so there is nothing to rescale. On the live database it had already run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Depot' AND column_name = 'accountObols'
  ) THEN
    -- An obol went from 5 ⬢ to 1, so every obol anybody holds lost 80% of its
    -- purchasing power. The catalog prices in ⬢ and only the counter converts,
    -- so no authored price moved — every obol AMOUNT did, x5, here and in the
    -- YAML masters.
    UPDATE "Depot" SET "accountObols" = "accountObols" * 5;
  END IF;
END $$;
