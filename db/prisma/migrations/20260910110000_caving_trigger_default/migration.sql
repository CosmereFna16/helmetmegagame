-- The turn-start sweep is gone, so ARRIVAL is the only trigger anything can
-- write. A column defaulting to a value nothing can produce is a trap for the
-- next writer. See docs/systemdocs/CAVING.md §2.
ALTER TABLE "CavingRoll" ALTER COLUMN "trigger" SET DEFAULT 'ARRIVAL';
