"use client";

import { useState } from "react";

// Long free text in a table cell. A GM has to be able to read a whole Move
// description to adjudicate it, but a wall of prose in every row makes the
// table unscannable — so the cell clamps to a few lines and offers More.
//
// The clamp is CSS only: the full string is always in the DOM, so browser
// find-in-page and the table's own search still hit text that is currently
// folded away. Nothing here cuts the string, and nothing upstream should
// either — a truncation done server-side can't be undone by a button.
//
// Whether to offer the toggle is decided by character count rather than by
// measuring the rendered box. Measuring means an effect that writes state on
// layout, which `react-hooks/set-state-in-effect` forbids in this repo (see
// CLAUDE.md). The count is an approximation of "does this overflow `lines`
// lines", and being a little generous is harmless: the worst case is a More
// button that reveals one extra word.
export default function ExpandableText({ text, lines = 3, threshold = 160, mono = false, className = "" }) {
  const [open, setOpen] = useState(false);

  const clean = (text ?? "").trim();
  if (!clean) return null;

  const base = `${mono ? "mono " : ""}${className}`.trim();

  const overflows = clean.length > threshold || clean.split("\n").length > lines;
  if (!overflows) {
    return <span className={`block whitespace-pre-wrap ${base}`.trim()}>{clean}</span>;
  }

  return (
    <>
      <span
        className={`block whitespace-pre-wrap ${base}`.trim()}
        style={
          open
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
                overflow: "hidden",
              }
        }
      >
        {clean}
      </span>
      <button type="button" className="btn-quiet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Less" : "More"}
      </button>
    </>
  );
}
