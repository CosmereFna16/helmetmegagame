"use client";

import Tooltip from "./Tooltip";

// The one framed icon button. `.icon-btn` already carries the frame and the
// accent-on-hover fill every other button in the app uses; this just spares
// each call site from repeating the a11y wiring and the glyph sizing.
// `label` is the accessible name and must stay a plain string — it goes
// straight into aria-label, where JSX would read as "[object Object]".
// `tooltip` is the optional rich version for sighted hover (ActionGrid.js
// passes the action's name plus a sentence on what it does); without one the
// tooltip is just the label, which is what every older call site wants.
export default function IconButton({ icon: Icon, label, tooltip = null, onClick, disabled = false, ...rest }) {
  return (
    <Tooltip text={tooltip ?? label}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        {...rest}
      >
        <Icon width="15" height="15" />
      </button>
    </Tooltip>
  );
}
