// A setting that is on or off, as opposed to a row that is selected — see the
// Booleans block in globals.css for which shape means what.
//
// The control underneath is a real <input type="checkbox">, visually hidden
// rather than replaced, with .switch-track drawn as its sibling. That is the
// load-bearing detail: nine of these render inside gm/dev/page.js, a server
// component whose <form action> reads the control's `name` on submit. A
// <button role="switch"> would look identical and post nothing — which is the
// trap MovePanel's local Segmented fell into, having had the right instinct
// about affordance.
//
// Like CheckField, no "use client": it holds no state of its own, so it works
// uncontrolled from a server form (name + defaultChecked) or controlled from a
// client component (checked + onChange).
export default function Switch({ children, className = "", ...rest }) {
  return (
    <label className={`switch-row ${className}`.trim()}>
      <span>{children}</span>
      <input type="checkbox" {...rest} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}
