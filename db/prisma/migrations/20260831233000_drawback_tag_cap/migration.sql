-- GameConfig.maxNegativeTags always claimed to cap the NUMBER of drawback
-- tags a character may buy at creation, but actually capped the SUM of their
-- point value (see the dropped column's schema comment history). Replaced
-- with maxDrawbackTags, a real count, default 5 (0 is a real setting: no
-- drawbacks at all). See docs/systemdocs/TAGS.md §4a.

-- AlterTable
-- ADD-only on purpose: dropping "maxNegativeTags" here would break every
-- process still running the old Prisma client the instant this migration
-- lands (bot deploys can lag or be skipped behind web's Pre-Deploy migrate
-- step — see DEPLOY workflow in CLAUDE.md), since a select-less
-- gameConfig.findFirst() throws P2022 on a column the client still expects.
-- The column is dropped in a follow-up migration once both services are
-- confirmed on the new build. See docs/systemdocs/DESIRES.md ship notes.
ALTER TABLE "GameConfig"
ADD COLUMN     "maxDrawbackTags" INTEGER NOT NULL DEFAULT 5;
