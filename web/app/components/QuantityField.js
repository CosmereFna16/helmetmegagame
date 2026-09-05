"use client";

// The one quantity control in the app: − / number / +, with the clamp in a
// single place. Before this there were nine hand-rolled <input type="number">
// doing the same job, and they had already drifted — CraftDialog offered 99 of
// anything while Destroy/Transfer/Loot clamped to the held count, and widths
// ran 4rem / 7rem / 10rem depending on which one you landed on.
//
// `value` is a STRING draft, not a number, so an empty box doesn't snap back
// to the minimum mid-edit. Every caller already worked that way; this just
// keeps it honest. onChange is handed a string too.
//
// Two shapes:
//   - default: wrapped in a .field with its own label, for dialogs.
//   - inline:  bare, for a row in a list or table. Pass `ariaLabel`.
//
// `allowBlank` lets an empty box mean something — the adjudication composer's
// remove box reads blank as "the whole holding" — in which case the steppers
// treat blank as `blankValue` and clearing the box is a real choice.
//
// `onCommit` is for a caller that must not act on every keystroke: it fires on
// blur, and straight after a − / + press (which is already a finished
// gesture). Typing "12" one digit at a time would otherwise commit a 1 first.

// Parse a draft to a number, or null when it isn't one. Exported so a caller
// can read the same value the buttons act on rather than re-deriving it.
export function parseQuantity(raw, { min = 1, max } = {}) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isInteger(n)) return null;
  if (n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

export default function QuantityField({
  value,
  onChange,
  onCommit,
  min = 1,
  max,
  label,
  hint,
  inline = false,
  allowBlank = false,
  // What a blank box counts as when a stepper button is pressed on one.
  blankValue = min,
  disabled = false,
  ariaLabel,
}) {
  const blank = allowBlank && String(value ?? "").trim() === "";
  const current = blank ? blankValue : (parseQuantity(value, { min, max }) ?? min);

  function step(by) {
    const next = current + by;
    if (next < min) return;
    if (max != null && next > max) return;
    onChange(String(next));
    onCommit?.(String(next));
  }

  const atMin = !blank && current <= min;
  const atMax = max != null && !blank && current >= max;

  const control = (
    <span className="qty">
      <button
        type="button"
        className="qty-btn"
        onClick={() => step(-1)}
        disabled={disabled || atMin}
        aria-label="One fewer ‡"
        tabIndex={-1}
      >
        −
      </button>
      <input
        type="number"
        className="qty-input"
        min={min}
        max={max}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : "Quantity")}
      />
      <button
        type="button"
        className="qty-btn"
        onClick={() => step(1)}
        disabled={disabled || atMax}
        aria-label="One more ‡"
        tabIndex={-1}
      >
        +
      </button>
    </span>
  );

  if (inline) return control;

  return (
    <label className="field qty-field">
      {label && <span className="field-label">{label}</span>}
      {control}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
