// A checkbox and the sentence explaining it, on one line.
//
// Deliberately NOT "use client". Nine of the app's 26 checkboxes live in
// gm/dev/page.js, which is a server component posting through a form action
// and passing only name/defaultChecked; the rest (RequestPanel, MovePanel,
// IdentityTab) are client components passing onChange. A leaf with no
// directive works from both — adding one here would quietly force every
// server page that renders a checkbox into the client bundle.
//
// `children` is the label, not a `label` prop: every call site already writes
// its text inline, several with interpolation ("DM the Result to {name} when
// I solve this"), so this is a pure wrap rather than a rewrite. Everything
// else spreads onto the input, so name/checked/defaultChecked/onChange/
// disabled/required/aria-label all pass through untouched.
export default function CheckField({ children, className = "", ...rest }) {
  return (
    <label className={`check-row ${className}`.trim()}>
      <input type="checkbox" {...rest} />
      <span>{children}</span>
    </label>
  );
}
