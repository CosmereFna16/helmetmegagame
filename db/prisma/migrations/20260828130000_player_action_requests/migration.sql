-- Five new RequestType values for the player Actions grid: BIND_CHARACTER,
-- FREE_CHARACTER, HARM_CHARACTER, DROP_ITEM, PICK_UP_ITEM.
--
-- Enum-only, in its own migration on purpose. Postgres will not let a value
-- be USED in the same transaction that added it, and Prisma runs each
-- migration file in one transaction — so anything referencing these labels in
-- SQL has to land in a later file. Nothing here does; the separation is what
-- keeps that true if someone adds a backfill later.
ALTER TYPE "RequestType" ADD VALUE 'BIND_CHARACTER';
ALTER TYPE "RequestType" ADD VALUE 'FREE_CHARACTER';
ALTER TYPE "RequestType" ADD VALUE 'HARM_CHARACTER';
ALTER TYPE "RequestType" ADD VALUE 'DROP_ITEM';
ALTER TYPE "RequestType" ADD VALUE 'PICK_UP_ITEM';
