-- Labor becomes a third kind of Move, alongside Routine and Gambit.
--
-- Alone in its own migration on purpose: Postgres will not let a value added
-- by ALTER TYPE ... ADD VALUE be USED by another statement in the same
-- transaction, and Prisma runs one migration.sql per transaction. Keeping the
-- enum change by itself means the next migration - and every deploy after it -
-- can reference 'LABOR' freely.
ALTER TYPE "MoveKind" ADD VALUE 'LABOR';
