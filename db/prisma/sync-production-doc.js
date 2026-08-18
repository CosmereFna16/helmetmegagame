// Manual, terminal-invoked sync from db/lib/production.js (× GameConfig's
// productionCoefficient) -> the "Producing Resources" entry's description in
// docs/documents.yaml. Run with `npm run db:sync-production-doc`. Never runs
// automatically (no cron, no per-turn hook, not called from /labor) — same
// explicit-push convention as sync-locations.js. Re-run this by hand after
// changing productionCoefficient from the Dev Panel so the doc text doesn't
// drift from what /labor actually pays out.
//
// Does a targeted string replace of just the numeric lines in the
// "production" doc's description, not a full YAML parse/dump — the rest of
// this hand-authored file (quoting, block styles, comments, other entries)
// is left completely untouched.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { prisma } = require("../index");
const { PRODUCTION_RATES, HUNTING_DICE, computeRate } = require("../lib/production");

const DOCS_PATH = path.join(__dirname, "..", "..", "docs", "documents.yaml");

function replaceLine(text, prefix, newLine) {
  const re = new RegExp(`^( *)${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "m");
  if (!re.test(text)) throw new Error(`Could not find a line starting with "${prefix}" in ${DOCS_PATH}`);
  return text.replace(re, (_match, indent) => `${indent}${newLine}`);
}

async function main() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const coefficient = config?.productionCoefficient ?? 1;

  const rate = (field, tier) => computeRate(field, tier, coefficient);

  let text = fs.readFileSync(DOCS_PATH, "utf8");

  text = replaceLine(
    text,
    "Herding (Effort):",
    `Herding (Effort): ${rate("herding", "base")} Resources for anyone; ${rate("herding", "laborer")} with Laborer; ${rate("herding", "specialist")} with Laborer (Herding).`,
  );
  text = replaceLine(
    text,
    "Farming (Effort):",
    `Farming (Effort): ${rate("farming", "base")} Resources for anyone; ${rate("farming", "laborer")} with Laborer; ${rate("farming", "specialist")} with Laborer (Farming). Must be in Town or Fortress (the only arable land).`,
  );
  text = replaceLine(
    text,
    "Fishing (Effort):",
    `Fishing (Effort): ${rate("fishing", "base")} Resources for anyone; ${rate("fishing", "laborer")} with Laborer; ${rate("fishing", "specialist")} with Laborer (Fishing). Must be in Town or Fortress (near the river).`,
  );
  text = replaceLine(
    text,
    "Hunting (Effort):",
    `Hunting (Effort): ${HUNTING_DICE.base} Resources for anyone (*3 with Hunter tag), must be in Town, Fortress, or Caves.`,
  );
  text = replaceLine(
    text,
    "To automatically add Resources",
    `To automatically add Resources on an Effort, type +(resources) anywhere in your message. For example, write “I hunt. +${HUNTING_DICE.specialist}” or “I farm. +${rate("farming", "specialist")}”.`,
  );

  fs.writeFileSync(DOCS_PATH, text);
  console.log(`Synced docs/documents.yaml's production doc at coefficient ${coefficient}:`);
  for (const field of Object.keys(PRODUCTION_RATES)) {
    console.log(`  ${field}: ${rate(field, "base")} / ${rate(field, "laborer")} / ${rate(field, "specialist")}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
