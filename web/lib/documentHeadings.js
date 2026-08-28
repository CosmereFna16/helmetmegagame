import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";

// GitHub's own heading-slug algorithm, close enough to match docs/handbook.md's
// hand-written ToC anchors (#talking--roleplay, #resources--hunger — the
// double dash comes from "&" being stripped rather than replaced). Shared by
// DocumentMarkdown.js (which must produce the same id an authored `[x](#y)`
// link points at) and getDocumentHeadings below (the sheet's generated ToC),
// so the two can never slug the same heading two different ways.
export function slugifyHeading(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      // Each space becomes its own hyphen — NOT collapsed with \s+. GitHub's
      // algorithm removes punctuation first and only then swaps every
      // individual space for a dash, so two spaces left behind by a removed
      // "&" become two dashes: "Talking & Roleplay" -> "talking--roleplay",
      // the exact anchor docs/handbook.md's own Table of Contents links to.
      .replace(/ /g, "-")
  );
}

// A plain-text taste of a Markdown document's headings, for the .doc-sheet's
// generated table of contents. Built the same way documentPreview.js is
// (remark-parse + gfm + mdast-util-to-string over the raw tree) rather than
// off the rendered React tree, so it needs no DOM and agrees with
// DocumentMarkdown's slugs by construction — both start from the same
// heading text.
export function getDocumentHeadings(markdown, { maxDepth = 3 } = {}) {
  if (!markdown) return [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children
    .filter((node) => node.type === "heading" && node.depth <= maxDepth)
    .map((node) => {
      const text = mdastToString(node);
      return { depth: node.depth, text, id: slugifyHeading(text) };
    });
}
