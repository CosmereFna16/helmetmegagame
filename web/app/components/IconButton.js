"use client";

import Tooltip from "./Tooltip";

// The one framed icon button. `.icon-btn` already carries the frame and the
// accent-on-hover fill every other button in the app uses; this just spares
// each call site from repeating the a11y wiring and the glyph sizing.
export default function IconButton({ icon: Icon, label, onClick, disabled = false, ...rest }) {
  return (
    <Tooltip text={label}>
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
