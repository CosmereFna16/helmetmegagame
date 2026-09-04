-- The Leader Whitelist stops being about Leaders. `Role.grantsLeader` did two
-- unrelated jobs: it made the holder their faction's Leader, and it gated the
-- seat behind the @Leader Whitelist Discord role. Split the second one out.
ALTER TABLE "Role" ADD COLUMN "requiresWhitelist" BOOLEAN NOT NULL DEFAULT false;

-- Preserve today's behaviour on the way in: every seat that was gated because
-- it granted Leader stays gated. db:sync-roles re-applies the YAML after this,
-- which is what adds the Hand and the Arbiter.
UPDATE "Role" SET "requiresWhitelist" = true WHERE "grantsLeader" = true;
