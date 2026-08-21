-- Split Character.name into honorific / firstName / title / lastName.
--
-- The split happens here in SQL rather than in a backfill script so there is
-- never a window where firstName is NULL in production. `name` itself is left
-- untouched: nobody has a title or honorific yet, so formatCharacterName()
-- reproduces the existing string exactly for every row. Nothing renames,
-- nothing recolours, and no Discord call fires on deploy.

ALTER TABLE "Character"
  ADD COLUMN "honorific" TEXT,
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "title"     TEXT,
  ADD COLUMN "lastName"  TEXT;

-- First-space split, remainder to lastName, mirroring
-- db/lib/characterName.js#splitLegacyName:
--   'Jorren Vask'         -> 'Jorren' / 'Vask'
--   'Marrow'              -> 'Marrow' / NULL
--   'Anna Maria de Vries' -> 'Anna'   / 'Maria de Vries'
-- btrim first, exactly as splitLegacyName does: a leading space would
-- otherwise split into an empty firstName and shunt the whole name into
-- lastName.
UPDATE "Character" c SET
  "firstName" = CASE WHEN p.at > 0 THEN left(p.n, p.at - 1) ELSE p.n END,
  "lastName"  = CASE WHEN p.at > 0
                     THEN NULLIF(btrim(substring(p.n from p.at + 1)), '')
                     ELSE NULL END
FROM (
  SELECT id, btrim("name") AS n, position(' ' in btrim("name")) AS at
  FROM "Character"
) p
WHERE c.id = p.id;

-- Defensive: an empty legacy name would otherwise block the NOT NULL below.
UPDATE "Character" SET "firstName" = '' WHERE "firstName" IS NULL;

ALTER TABLE "Character" ALTER COLUMN "firstName" SET NOT NULL;
