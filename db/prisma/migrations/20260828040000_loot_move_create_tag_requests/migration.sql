-- Three new RequestType values: LOOT_CHARACTER, MOVE_CHARACTER, CREATE_TAG.
-- ALTER TYPE ... ADD VALUE is non-destructive and does not lock existing rows.
ALTER TYPE "RequestType" ADD VALUE 'LOOT_CHARACTER';
ALTER TYPE "RequestType" ADD VALUE 'MOVE_CHARACTER';
ALTER TYPE "RequestType" ADD VALUE 'CREATE_TAG';
