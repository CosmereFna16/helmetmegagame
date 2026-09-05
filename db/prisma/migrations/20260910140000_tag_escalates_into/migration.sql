-- The drinking ladder: a status tag names the rung above it, so drinking
-- again while you already hold one moves you up rather than doing nothing.
-- tipsy -> wasted -> unconscious. See docs/systemdocs/BREWING.md.
ALTER TABLE "Tag" ADD COLUMN "escalatesInto" TEXT;
