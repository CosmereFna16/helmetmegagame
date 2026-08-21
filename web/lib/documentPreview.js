import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";

// A plain-text taste of a Markdown document's prose, for the /documents card
// preview — a <button>, so it can't hold DocumentMarkdown.js's interactive
// chips/links/tables (see that file's header comment). Table blocks are
// dropped entirely rather than flattened: mashing a grid's cells into one
// text run reads as noise, not a preview. {tag:...}/{resource:...} tokens
// are left as literal text in the tree (remarkTokens.js never runs here) —
// ChipText, which the caller feeds this through, resolves those itself.
export function toDocumentPreviewText(markdown) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children
    .filter((node) => node.type !== "table")
    .map((node) => mdastToString(node))
    .join("\n\n");
}
