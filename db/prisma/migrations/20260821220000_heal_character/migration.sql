-- AlterEnum
-- Postgres only refuses to USE a new enum value in the transaction that adds
-- it; nothing below references it, so one file is fine (same shape as
-- 20260821200000_worst_fear).
ALTER TYPE "RequestType" ADD VALUE 'HEAL_CHARACTER';
