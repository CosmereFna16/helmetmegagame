-- The Merchant Update: three request kinds for the Depot counter.
--
-- These sit in their own migration ON PURPOSE. Postgres refuses to use an
-- enum value in the same transaction that added it, and Prisma wraps each
-- migration file in one transaction — so adding the values and then writing
-- a row that uses them from a single file would fail. Nothing here touches a
-- table, and the column migration that follows adds no enum values.
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_BUY';
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_SELL';
ALTER TYPE "RequestType" ADD VALUE 'DEPOT_CREDIT';
