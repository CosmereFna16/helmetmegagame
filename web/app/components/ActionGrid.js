"use client";

import IconButton from "./IconButton";
import { useRequestActions } from "./RequestActionsProvider";
import { ACTION_SECTIONS, ACTION_HELP } from "./actionRegistry";

// Everything a player can do to a sheet, as captioned rows of icons on the
// right of the Status panel. The list itself lives in actionRegistry.js;
// this only lays it out.
//
// Rows, not a fixed grid. The old four-across grid left one icon stranded
// on its own row whenever the count wasn't a multiple of four, and the
// count is about to keep growing. Each section is a `flex-wrap` row under a
// small caption, so any number of icons fills left to right and wraps
// wherever the width says; a section with nothing to show (no bird, no
// literacy) is left out entirely. Below `sm` the whole block drops under
// the <dl> beside it, same as before.

// The tooltip is the label plus, where there is one, the sentence explaining
// what the action actually does — IconButton already renders `label` through
// Tooltip, so hovering tells you what a glyph means without a second control.
function tooltipFor({ label, mode }) {
  const help = ACTION_HELP[mode];
  if (!help) return label;
  return (
    <>
      <p>
        <strong>{label}</strong>
      </p>
      {typeof help === "string" ? <p>{help}</p> : help}
    </>
  );
}

export default function ActionGrid() {
  const actions = useRequestActions();
  if (!actions) return null;
  const { open, pools } = actions;

  return (
    <div className="flex flex-col gap-2">
      {ACTION_SECTIONS.map((section) => {
        const visible = section.actions.filter((a) => (a.show ? pools[a.show] : true));
        if (visible.length === 0) return null;
        return (
          <div key={section.key}>
            <p className="field-label mb-1">{section.label}</p>
            <div className="flex flex-wrap gap-1" style={{ maxWidth: "12rem" }}>
              {visible.map((a) => (
                <IconButton
                  key={a.mode}
                  icon={a.icon}
                  label={a.label}
                  tooltip={tooltipFor(a)}
                  onClick={() => open(a.mode)}
                  disabled={a.gate ? !pools[a.gate] : false}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
