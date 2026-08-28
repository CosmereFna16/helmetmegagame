-- The Merchant Update: the two columns the Depot counter reads.
--
-- Tag.depotPrice is what the orbital station charges the Merchant for one
-- unit; it pairs with the existing Tag.sellablePrice, which is what the
-- station pays him. Null means the Depot does not stock the tag at all.
--
-- Character.depotDebt is ⬢ drawn against the Company's credit line. The ⬢
-- themselves land in Character.resources; this is what he owes back.
ALTER TABLE "Tag" ADD COLUMN "depotPrice" INTEGER;
ALTER TABLE "Character" ADD COLUMN "depotDebt" INTEGER NOT NULL DEFAULT 0;
