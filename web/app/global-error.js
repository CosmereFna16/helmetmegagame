"use client";

// The last resort: this replaces the ROOT layout, so it only renders when the
// root layout itself threw — before the theme, the fonts or any provider
// existed. Everything else is caught one level down by app/error.js.
//
// Because it replaces the layout it has to supply its own <html> and <body>,
// and Next does not give it the app's global styles for free. Importing them
// here is what keeps the zero-hardcoded-colour rule intact: every colour below
// is still a var(--x) from globals.css. The next/font variables are the one
// thing that can't follow, since those live on the root layout's <html> — each
// font-family in globals.css carries a real fallback stack, so the page reads
// in a system face instead of Source Sans.
//
// data-theme is pinned rather than derived: the turn phase comes from the
// database, and this file exists precisely for the case where reading it is
// what failed.
//
// Next 16 names the recovery prop `retry`, not `reset`.

import "./globals.css";

export default function GlobalError({ error, retry }) {
  return (
    <html lang="en" data-theme="dusk" className="h-full">
      <body className="h-full">
        <title>Bascinet</title>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-8">
          <h1 className="text-2xl font-bold">Bascinet is down</h1>
          <div className="panel flex flex-col items-start gap-4 p-4">
            <p className="text-sm text-muted">
              This isn&apos;t your browser — something broke on our side. Tell a GM, and give them the
              reference below so they can find it in the logs.
            </p>
            {error?.digest && <p className="mono text-xs text-muted">Reference: {error.digest}</p>}
            <button type="button" className="btn" onClick={() => retry?.()}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
