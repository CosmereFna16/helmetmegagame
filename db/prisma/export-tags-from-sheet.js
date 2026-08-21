#!/usr/bin/env node
// npm run sheet:export-tags
// Exports tags from Google Sheet to docs/tags.yaml

const { exportTagsFromSheet } = require("../lib/exportTagsFromSheet");

exportTagsFromSheet()
  .then(() => {
    console.log("✓ Tags exported successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("✗ Export failed:", err.message);
    process.exit(1);
  });
