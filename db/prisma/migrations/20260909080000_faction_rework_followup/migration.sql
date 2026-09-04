-- Follow-up to the faction rework. Two columns nothing ever read: every
-- decision already writes an AuditLog row naming the actor, and "updatedAt"
-- is the timestamp.
ALTER TABLE "FactionApplication" DROP COLUMN "decidedById";
ALTER TABLE "FactionApplication" DROP COLUMN "decidedAt";
