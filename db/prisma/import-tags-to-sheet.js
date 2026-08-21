#!/usr/bin/env node
// IMPORT_SOURCE_SHEET_ID=<sheet-id> npm run sheet:import-tags

const { importTagsToSheet } = require("../lib/importTagsToSheet");

importTagsToSheet()
  .then(() => {
    console.log("✓ Tags imported successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("✗ Import failed:", err.message);
    process.exit(1);
  });
