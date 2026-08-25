-- DropIndex
DROP INDEX "ArchiveEntry_sentAt_idx";

-- AlterTable
ALTER TABLE "Turn" ADD COLUMN     "needsResolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedPasses" JSONB;

-- CreateIndex
CREATE INDEX "Action_createdAt_idx" ON "Action"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Action_characterId_turnId_key" ON "Action"("characterId", "turnId");

-- CreateIndex
CREATE INDEX "ArchiveEntry_sentAt_id_idx" ON "ArchiveEntry"("sentAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetCharacterId_idx" ON "AuditLog"("targetCharacterId");

-- CreateIndex
CREATE INDEX "Request_createdAt_idx" ON "Request"("createdAt");


-- Backfill: every turn that already finished predates this tracking. Without
-- this, the first advance after deploy would find the newest RESOLVED turn
-- carrying a null needsResolvedAt, conclude a previous run died mid-flight,
-- and re-apply that turn's hunger and decay on top of a turn that completed
-- normally months ago.
UPDATE "Turn" SET "needsResolvedAt" = COALESCE("resolvedAt", "startedAt") WHERE "status" = 'RESOLVED';

-- /archive's free-text search is `content ILIKE '%q%'`, which no btree index
-- can serve — so it sequential-scans the whole transcript, twice per search
-- (once for the page, once for the count beside it). At ~850 messages on a
-- busy turn that table is the fastest-growing thing in the schema.
--
-- A trigram GIN index is the one thing that makes a leading-wildcard ILIKE
-- indexable. Written as raw SQL because Prisma's schema language cannot
-- express an operator-class index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "ArchiveEntry_content_trgm_idx" ON "ArchiveEntry" USING GIN ("content" gin_trgm_ops);
