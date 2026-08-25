"use client";

// The boundary above (app)/error.js: it catches a throw in the (app) layout
// itself — the auth lookup, the GM role check, the open-turn read — which the
// inner boundary cannot, since error.js never wraps the layout in its own
// segment. Rendered inside the root layout, so the theme, the fonts and the
// atmosphere layers are all still here.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function RootError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
