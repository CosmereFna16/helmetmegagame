-- The Bird's request type (docs/systemdocs/BIRD.md).
--
-- Enum-only, in its own file, for the reason
-- 20260828130000_player_action_requests spells out: Postgres will not let a
-- value be USED in the same transaction that added it, and Prisma runs each
-- migration file in one transaction. The table and column that go with this
-- land in the next migration.
ALTER TYPE "RequestType" ADD VALUE 'BIRD_MESSAGE';
