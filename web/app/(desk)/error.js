"use client";

// Catches anything thrown while rendering a desk page. (app) has had one of
// these for a while; (desk) did not, so a bad render there fell all the way to
// app/global-error.js and took the whole document with it. Now that the desk
// carries the nav rail, keeping the boundary here means a GM can walk away
// from a broken desk instead of reloading.
//
// Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function DeskError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
