-- Point prices across docs/tags.yaml were rescaled x2.25; the starting
-- point-buy budget doubles to match (planning: tag rebalance).
ALTER TABLE "GameConfig" ALTER COLUMN "startingTagPoints" SET DEFAULT 12;
