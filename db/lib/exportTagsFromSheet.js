// Google Sheet -> docs/tags.yaml
// Reads tag data from a Google Sheet and exports to YAML format.
// Requires GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY (JSON file path) environment variable.

require("dotenv").config({ path: ".env" });

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const SHEET_ID = process.env.TAGS_SHEET_ID || "1yWqkHqJAKdPYe6TmLBm-QClGJzi7uauioCef37RPvNI";
const TAGS_SHEET_NAME = "Tags"; // Update if your sheet has a different name

async function exportTagsFromSheet() {
  const keyFilePath = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
  if (!keyFilePath) {
    throw new Error("GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY environment variable not set");
  }

  const credentials = JSON.parse(fs.readFileSync(keyFilePath, "utf8"));
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, auth);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[TAGS_SHEET_NAME];
  if (!sheet) {
    throw new Error(`Sheet "${TAGS_SHEET_NAME}" not found. Available sheets: ${Object.keys(doc.sheetsByTitle).join(", ")}`);
  }

  const rows = await sheet.getRows();
  if (rows.length === 0) {
    throw new Error(`Sheet "${TAGS_SHEET_NAME}" has no data rows`);
  }

  // Parse rows into tag objects
  const tags = rows
    .map((row) => parseTagRow(row))
    .filter(Boolean); // Remove null entries (empty rows)

  // Build the YAML structure
  const yamlData = {
    categories: [
      { slug: "meta", name: "Meta" },
      { slug: "general", name: "General" },
      { slug: "skills", name: "Skills" },
      { slug: "status", name: "Status" },
      { slug: "items", name: "Items" },
      { slug: "assets", name: "Assets" },
    ],
    tags,
  };

  // Write to docs/tags.yaml
  const yamlPath = path.join(__dirname, "..", "..", "docs", "tags.yaml");
  const yamlContent = buildYamlContent(yamlData);
  fs.writeFileSync(yamlPath, yamlContent, "utf8");

  console.log(`✓ Exported ${tags.length} tags to ${yamlPath}`);
  return tags.length;
}

function parseTagRow(row) {
  // Helper to safely parse booleans and numbers
  const getBoolean = (val) => {
    if (val === null || val === undefined || val === "") return undefined;
    return String(val).toLowerCase() === "true" || val === 1 || val === "1";
  };

  const getNumber = (val) => {
    if (val === null || val === undefined || val === "") return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  };

  const getString = (val) => {
    return val && String(val).trim() !== "" ? String(val).trim() : undefined;
  };

  const getList = (val) => {
    if (!val) return undefined;
    const str = String(val).trim();
    if (!str) return undefined;
    return str.split(/[,;]/).map((s) => s.trim());
  };

  // Skip empty rows
  if (!row.slug || !String(row.slug).trim()) {
    return null;
  }

  const tag = {
    slug: getString(row.slug),
    name: getString(row.name),
    category: getString(row.category),
  };

  // Add optional fields only if they have values
  if (row.description) tag.description = getString(row.description);
  if (row.group) tag.group = getString(row.group);

  const pointCost = getNumber(row.pointCost);
  if (pointCost !== undefined) tag.pointCost = pointCost;

  if (row.purchasable !== undefined) {
    const val = getBoolean(row.purchasable);
    if (val !== undefined) tag.purchasable = val;
  }

  if (row.purchasableAfterStart !== undefined) {
    const val = getBoolean(row.purchasableAfterStart);
    if (val !== undefined) tag.purchasableAfterStart = val;
  }

  if (row.visible !== undefined) {
    const val = getBoolean(row.visible);
    if (val !== undefined) tag.visible = val;
  }

  if (row.durationTurns !== undefined) {
    const val = getNumber(row.durationTurns);
    if (val !== undefined) tag.durationTurns = val;
  }

  if (row.removable !== undefined) {
    const val = getBoolean(row.removable);
    if (val !== undefined) tag.removable = val;
  }

  if (row.craftable !== undefined) {
    const val = getBoolean(row.craftable);
    if (val !== undefined) tag.craftable = val;
  }

  if (row.stackable !== undefined) {
    const val = getBoolean(row.stackable);
    if (val !== undefined) tag.stackable = val;
  }

  if (row.tradeable !== undefined) {
    const val = getBoolean(row.tradeable);
    if (val !== undefined) tag.tradeable = val;
  }

  if (row.parentTag) tag.parentTag = getString(row.parentTag);
  if (row.requiredTag) tag.requiredTag = getString(row.requiredTag);

  if (row.grantsOnExpiry) {
    const grants = getList(row.grantsOnExpiry);
    if (grants) tag.grantsOnExpiry = grants;
  }

  // requirement is a complex object — store as JSON in the sheet and parse it
  if (row.requirement) {
    try {
      tag.requirement = JSON.parse(String(row.requirement));
    } catch (e) {
      console.warn(`Failed to parse requirement for "${tag.slug}": ${e.message}`);
    }
  }

  return tag;
}

function buildYamlContent(data) {
  // Custom YAML builder to preserve structure and comments
  let output = `# Sole master for the Tag catalog. TagGroup catalog is a sibling file,
# docs/taggroups.yaml — see there for group/color fields.
#
# Per-tag fields not covered elsewhere in this file:
#   durationTurns   - default turns-to-expire once granted, for tags that
#                     auto-expire (e.g. Drained: 3). Omit for tags that don't
#                     expire on their own.
#   removable       - whether a player can strip this tag off themselves
#                     mid-game without a GM. Catalog data only for now (the
#                     mid-game tag store isn't routed yet). Default false.
#   craftable       - whether this tag represents something a player can
#                     craft/make, vs. one that only ever arrives via role, GM
#                     grant, or automatic game logic. Catalog data only for
#                     now. Default false.
#   stackable       - whether a character can hold more than one at a time
#                     (meals, ammunition, anything a crafting Move makes in a
#                     batch). Default false. A stack is one CharacterTag row
#                     carrying a count, not N rows, so presence checks are
#                     unaffected. Fine to combine with durationTurns: each
#                     expiry sheds one unit and restarts the timer for the
#                     rest, so 3 of a 2-turn tag lose one every 2 turns.
#   grantsOnExpiry  - list of tag slugs this tag turns INTO when it expires,
#                     instead of expiry only taking something away (Starting
#                     Wares unpacking into goods; a Wound leaving a Scar; a
#                     sickness resolving into a lasting condition). Needs
#                     durationTurns to ever fire. Repeat a slug to grant
#                     several of it — that only multiplies for a stackable
#                     tag, a non-stackable repeat collapses to one. Granted
#                     tags that have their own durationTurns start their
#                     clock at that moment, so chains work. If the character
#                     already holds a non-stackable granted tag, their
#                     existing one is left alone.
#   requirement:    - what it costs a character to add or remove this tag in
#                     play (GM adjudication reference, also shown to
#                     players; not automated/enforced by any code). One
#                     shared block covers whichever direction is
#                     narratively relevant to a given tag - e.g. crafting a
#                     sword only cares about the cost to add it, curing
#                     Arthritis only cares about the cost to remove it.
#     turnsCost     - turns of in-game time
#     resourceCost  - resource cost
#     skills        - list of skill tag slugs required; multiple accepted
#     gambit        - whether a Gambit roll is needed
categories:
`;

  // Add categories
  for (const cat of data.categories) {
    output += `  - slug: ${cat.slug}\n    name: ${cat.name}\n`;
  }

  output += `
# TagGroup catalog (Traits, Social, Health, ...) now lives in
# docs/taggroups.yaml — split out so group colors can be freeform hex
# instead of a fixed token set. Tags below reference a group by its slug
# via \`group:\`, same as before.

tags:
`;

  // Add tags
  for (const tag of data.tags) {
    output += `  - slug: ${tag.slug}\n`;
    output += `    name: ${tag.name}\n`;
    output += `    category: ${tag.category}\n`;

    if (tag.description) {
      output += `    description: ${JSON.stringify(tag.description)}\n`;
    }

    if (tag.group) {
      output += `    group: ${tag.group}\n`;
    }

    if (tag.pointCost !== undefined) {
      output += `    pointCost: ${tag.pointCost}\n`;
    }

    if (tag.purchasable !== undefined) {
      output += `    purchasable: ${tag.purchasable}\n`;
    }

    if (tag.purchasableAfterStart !== undefined) {
      output += `    purchasableAfterStart: ${tag.purchasableAfterStart}\n`;
    }

    if (tag.visible !== undefined) {
      output += `    visible: ${tag.visible}\n`;
    }

    if (tag.parentTag) {
      output += `    parentTag: ${tag.parentTag}\n`;
    }

    if (tag.requiredTag) {
      output += `    requiredTag: ${tag.requiredTag}\n`;
    }

    if (tag.tradeable !== undefined) {
      output += `    tradeable: ${tag.tradeable}\n`;
    }

    if (tag.stackable !== undefined) {
      output += `    stackable: ${tag.stackable}\n`;
    }

    if (tag.removable !== undefined) {
      output += `    removable: ${tag.removable}\n`;
    }

    if (tag.craftable !== undefined) {
      output += `    craftable: ${tag.craftable}\n`;
    }

    if (tag.durationTurns !== undefined) {
      output += `    durationTurns: ${tag.durationTurns}\n`;
    }

    if (tag.grantsOnExpiry) {
      output += `    grantsOnExpiry:\n`;
      for (const grant of tag.grantsOnExpiry) {
        output += `      - ${grant}\n`;
      }
    }

    if (tag.requirement) {
      output += `    requirement:\n`;
      if (tag.requirement.turnsCost !== undefined) {
        output += `      turnsCost: ${tag.requirement.turnsCost}\n`;
      }
      if (tag.requirement.resourceCost !== undefined) {
        output += `      resourceCost: ${tag.requirement.resourceCost}\n`;
      }
      if (tag.requirement.skills) {
        output += `      skills: [${tag.requirement.skills.join(", ")}]\n`;
      }
      if (tag.requirement.gambit !== undefined) {
        output += `      gambit: ${tag.requirement.gambit}\n`;
      }
    }

    output += "\n";
  }

  return output;
}

module.exports = { exportTagsFromSheet };

// Run if called directly
if (require.main === module) {
  exportTagsFromSheet()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
