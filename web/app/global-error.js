"use client";

// The last resort: this replaces the ROOT layout, so it only renders when the
// root layout itself threw, before the theme, fonts or any provider existed.
// It supplies its own <html>/<body> and imports globals.css directly since
// Next doesn't provide it here; data-theme is pinned rather than derived
// because reading the turn phase from the database is what may have failed.
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
