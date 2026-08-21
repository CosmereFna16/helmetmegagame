// Import tags from source Google Sheet to target Google Sheet
// Usage: IMPORT_SOURCE_SHEET_ID=... npm run sheet:import-tags

require("dotenv").config({ path: ".env" });

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_SHEET_ID = process.env.IMPORT_SOURCE_SHEET_ID;
const TARGET_SHEET_ID = process.env.TAGS_SHEET_ID || "1yWqkHqJAKdPYe6TmLBm-QClGJzi7uauioCef37RPvNI";
const TAGS_SHEET_NAME = "Tags";

async function importTagsToSheet() {
  if (!SOURCE_SHEET_ID) {
    throw new Error("IMPORT_SOURCE_SHEET_ID environment variable not set");
  }

  const keyFilePath = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
  if (!keyFilePath) {
    throw new Error("GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY environment variable not set");
  }

  // Resolve relative path from repo root
  const resolvedKeyPath = path.isAbsolute(keyFilePath)
    ? keyFilePath
    : path.join(__dirname, "..", "..", keyFilePath);

  const credentials = JSON.parse(fs.readFileSync(resolvedKeyPath, "utf8"));
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  // Load source sheet
  console.log("📖 Reading source sheet...");
  const sourceDoc = new GoogleSpreadsheet(SOURCE_SHEET_ID, auth);
  await sourceDoc.loadInfo();

  const sourceSheet = Object.values(sourceDoc.sheetsByTitle).find((s) => {
    const name = s.title.toLowerCase();
    return name.includes("tag") || name.includes("idea");
  });

  const sheet = sourceSheet || Object.values(sourceDoc.sheetsByTitle)[0];

  if (!sheet) {
    throw new Error(`No sheets found in source. Available: ${Object.keys(sourceDoc.sheetsByTitle).join(", ")}`);
  }

  console.log(`Using source sheet: "${sheet.title}"`);

  const sourceRows = await sheet.getRows();
  console.log(`Found ${sourceRows.length} rows in source sheet`);

  // Load target sheet
  console.log("🎯 Reading target sheet...");
  const targetDoc = new GoogleSpreadsheet(TARGET_SHEET_ID, auth);
  await targetDoc.loadInfo();

  const targetSheet = targetDoc.sheetsByTitle[TAGS_SHEET_NAME];
  if (!targetSheet) {
    throw new Error(`Sheet "${TAGS_SHEET_NAME}" not found in target`);
  }

  const targetRows = await targetSheet.getRows();
  const existingSlugs = new Set(targetRows.map((r) => normalizeSlug(r.get("slug"))));

  console.log(`Target sheet has ${targetRows.length} existing tags`);

  // Map source columns to normalized names
  const sourceHeader = sheet.headerValues;
  console.log("Source columns:", sourceHeader);

  const colMap = mapColumns(sourceHeader);
  console.log("Mapped columns:", colMap);

  // Import new tags
  let imported = 0;
  let skipped = 0;

  for (const sourceRow of sourceRows) {
    const rawSlug = sourceRow.get(colMap.slug);
    if (!rawSlug) {
      skipped++;
      continue;
    }

    const slug = normalizeSlug(rawSlug);

    if (!slug || existingSlugs.has(slug)) {
      if (slug) {
        console.log(`  ⊘ ${slug} already exists`);
      }
      continue;
    }

    const newRowData = {
      slug: slug,
    };

    // Map each field
    if (colMap.name) {
      newRowData.name = (sourceRow.get(colMap.name) || slug).trim();
    } else {
      newRowData.name = slug.replace(/-/g, " ");
    }

    if (colMap.description) {
      const desc = sourceRow.get(colMap.description);
      if (desc) newRowData.description = desc.trim();
    }

    if (colMap.category) {
      const cat = sourceRow.get(colMap.category);
      if (cat) {
        // Parse category from "category group" or "category"
        const parts = cat.toLowerCase().split(/\s+/);
        newRowData.category = parts[0];
        if (parts.length > 1 && parts[1] !== "group") {
          newRowData.group = cat.toLowerCase().replace(/\s+/g, "-");
        }
      }
    }

    if (colMap.group) {
      const grp = sourceRow.get(colMap.group);
      if (grp) newRowData.group = grp.trim();
    }

    if (colMap.pointCost !== undefined) {
      const val = sourceRow.get(colMap.pointCost);
      if (val && val !== "" && val !== null) {
        newRowData.pointCost = Number(val);
      }
    }

    if (colMap.purchasable !== undefined) {
      const val = sourceRow.get(colMap.purchasable);
      newRowData.purchasable = val === "TRUE" || val === true;
    }

    if (colMap.purchasableAfterStart !== undefined) {
      const val = sourceRow.get(colMap.purchasableAfterStart);
      newRowData.purchasableAfterStart = val === "TRUE" || val === true;
    }

    if (colMap.parentTag) {
      const val = sourceRow.get(colMap.parentTag);
      if (val) newRowData.parentTag = normalizeSlug(val.trim()) || undefined;
    }

    if (colMap.requiredTag) {
      const val = sourceRow.get(colMap.requiredTag);
      if (val) newRowData.requiredTag = normalizeSlug(val.trim()) || undefined;
    }

    if (colMap.durationTurns !== undefined) {
      const val = sourceRow.get(colMap.durationTurns);
      if (val && val !== "" && val !== null) {
        newRowData.durationTurns = Number(val);
      }
    }

    try {
      await targetSheet.addRow(newRowData);
      console.log(`  ✓ Added ${slug}`);
      imported++;
    } catch (err) {
      console.error(`  ✗ Failed to add ${slug}: ${err.message}`);
    }
  }

  console.log(`\n✓ Imported ${imported} new tags (${skipped} skipped empty rows)`);
  return imported;
}

function normalizeSlug(str) {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function mapColumns(headerValues) {
  // Try to identify columns by name matching
  const map = {};

  const lowerHeaders = headerValues.map((h) => String(h).toLowerCase().trim());

  // Slug/Name mappings
  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    if (h === "slug" || h === "id" || h === "role" || h === "tag name" || h === "name") {
      if (!map.slug) map.slug = headerValues[i];
    }
    if ((h === "name" || h === "title") && !map.name) {
      map.name = headerValues[i];
    }
    if (h === "description" || h === "desc" || h === "flavor") {
      if (!map.description) map.description = headerValues[i];
    }
    if (h === "category" || h === "cat" || h === "category + group" || h === "cat + group") {
      if (!map.category) map.category = headerValues[i];
    }
    if (h === "group" || h === "tag group") {
      if (!map.group) map.group = headerValues[i];
    }
    if (h === "cost" || h === "point cost" || h === "pointcost") {
      if (map.pointCost === undefined) map.pointCost = headerValues[i];
    }
    if (h === "purchasable") {
      if (map.purchasable === undefined) map.purchasable = headerValues[i];
    }
    if (h === "purchasableafterstart" || h === "purchasable after start") {
      if (map.purchasableAfterStart === undefined) map.purchasableAfterStart = headerValues[i];
    }
    if (h === "parenttag" || h === "parent tag" || h === "parent") {
      if (!map.parentTag) map.parentTag = headerValues[i];
    }
    if (h === "requiredtag" || h === "required tag" || h === "prereq" || h === "requirement") {
      if (!map.requiredTag) map.requiredTag = headerValues[i];
    }
    if (h === "durationturns" || h === "expiry" || h === "duration" || h === "expiry #") {
      if (map.durationTurns === undefined) map.durationTurns = headerValues[i];
    }
  }

  // If slug not found, use first column
  if (!map.slug) {
    map.slug = headerValues[0];
  }

  return map;
}

module.exports = { importTagsToSheet };

// Run if called directly
if (require.main === module) {
  importTagsToSheet()
    .then(() => {
      console.log("✓ Tags imported successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("✗ Import failed:", err.message);
      process.exit(1);
    });
}
