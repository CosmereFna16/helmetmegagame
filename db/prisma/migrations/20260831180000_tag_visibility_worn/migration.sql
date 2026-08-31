-- Tag.visibleOnInspect (boolean) becomes Tag.inspectVisibility (three-state),
-- so gear can be seen only while it is equipped. See docs/systemdocs/TAGS.md §5.
--
-- Written by hand rather than left to `migrate dev`, which would have dropped
-- the old column and defaulted every row to HIDDEN. A YAML tag would survive
-- that (the next db:sync-tags rewrites it), but a GM-authored custom tag never
-- passes through sync and would have silently gone invisible. Hence the
-- backfill between the ADD and the DROP.

-- CreateEnum
CREATE TYPE "TagVisibility" AS ENUM ('HIDDEN', 'ALWAYS', 'WORN');

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "inspectVisibility" "TagVisibility" NOT NULL DEFAULT 'HIDDEN';

-- Carry the old boolean over. Nothing becomes WORN here: that state is opted
-- into per tag in docs/tags.yaml, and db:sync-tags is what writes it.
UPDATE "Tag" SET "inspectVisibility" = 'ALWAYS' WHERE "visibleOnInspect" = true;

-- AlterTable
ALTER TABLE "Tag" DROP COLUMN "visibleOnInspect";
