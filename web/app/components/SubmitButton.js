"use client";

import { useFormStatus } from "react-dom";

// A submit button that knows whether its own form is in flight, so a
// double-click can't send a server action twice.
//
// useFormStatus reads the state of the nearest enclosing form from a CHILD
// of that form, so a server component keeps its <form action={...}> exactly
// as it is and just swaps in this button.
//
// `pendingLabel` defaults to the app's one busy verb. A more specific one is
// worth passing where the wait is long and the action is unusual.
export default function SubmitButton({
  children,
  pendingLabel = "Working…",
  className = "btn",
  disabled = false,
  ...rest
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending} {...rest}>
      {pending ? pendingLabel : children}
    </button>
  );
}
