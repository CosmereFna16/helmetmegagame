import "server-only";
import fs from "node:fs";
import { cache } from "react";
import { docsPath } from "@lifeweb/db/lib/repoPaths";

// docs/handbook.md, read at runtime — the first web-side reader of docs/
// outside a YAML sync. Goes through db/lib/repoPaths#docsPath rather than a
// hand-rolled `path.join(__dirname, ...)`: Turbopack inlines __dirname as a
// literal in the Next server build, which silently broke every other
// __dirname-based docs/ read in this container (see that file's header). A
// second, differently-broken copy of the same bug is not worth risking to
// avoid one cross-package import.
//
// React-cached rather than loaded once at module scope: module scope runs
// once per server process, so a handbook.md edit would need a redeploy to
// show up. cache() re-reads per request (cheap — one file, one page) while
// still deduping the two callers (the /documents card and /handbook) within
// a single request.
export const getHandbookText = cache(() => {
  const p = docsPath("handbook.md");
  if (!p) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
});

// The reader's own H1 is stripped: both surfaces that render this already
// carry the title in their own chrome (PageHeader on /handbook, the
// .doc-sheet-head on the pinned card), so keeping it in the body would print
// "Bascinet Player Handbook" twice.
export function getHandbookBody() {
  const text = getHandbookText();
  if (!text) return null;
  return text.replace(/^#\s+.*\n+/, "");
}

// Reserved in db/lib/syncDocuments.js#RESERVED_KEYS alongside "role" — see
// that file for why a synthesized card's key can never double as a real
// Document row's key.
export const HANDBOOK_KEY = "handbook";
