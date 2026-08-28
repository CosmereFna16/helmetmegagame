"use client";

// Mirrors (app)/error.js: catches anything thrown while rendering a page in
// this group so a broken /handbook doesn't fall through to Next's raw digest
// screen — the one route here that's meant to survive a link shared with
// someone who has never opened the app before.
//
// Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function PublicError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
