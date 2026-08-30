// A minimal desk skeleton — deliberately not SkeletonPage, which assumes the
// PageShell chrome this route group doesn't have. The push tray strip is
// always on screen on the real desk (StagingTray.js's `.desk-tray` /
// `.desk-tray-bar`, mirrored here rather than reinvented) — leaving it out of
// the skeleton was the exact "loading.js looks weird" symptom Gunboat flagged
// for this desk.
export default function Loading() {
  return (
    <div className="desk-shell">
      <header className="desk-header">
        <h1 className="section-title">Adjudication</h1>
      </header>
      <div className="desk-body">
        <aside className="desk-rail" aria-hidden="true" />
        <main className="desk-main">
          <p className="p-6 text-sm text-muted">Loading the queue…</p>
        </main>
        <aside className="desk-inspector" aria-hidden="true" />
      </div>
      <section className="desk-tray" aria-hidden="true">
        <div className="desk-tray-bar">
          <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <strong>Push tray</strong>
            <span className="mono">…</span>
          </span>
        </div>
      </section>
    </div>
  );
}
