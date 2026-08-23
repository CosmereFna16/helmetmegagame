"use client";

import { useFormStatus } from "react-dom";

// A submit button that knows whether its own form is in flight.
//
// Sixteen <form action={serverAction}> in the app had no pending feedback at
// all: the button stayed live through the round trip, so a double-click sent
// the action twice. Every component that DID show feedback had to become a
// client component and hand-roll useTransition to do it, which is why the
// server-rendered forms simply went without.
//
// useFormStatus is the piece that makes this cheap. It reads the state of the
// nearest enclosing form from a CHILD of that form -- so a server component
// keeps its <form action={...}> exactly as it is and swaps one button, rather
// than converting the page. It was unused anywhere in the codebase.
//
// `pendingLabel` defaults to the app's one busy verb. There were seven
// ("Working…", "Saving…", "Applying…", "Wiping…", "Creating…", "Resetting…",
// "Ending turn…"); the specific ones are worth keeping where the wait is long
// and the action is unusual, but nothing should have to invent one.
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
