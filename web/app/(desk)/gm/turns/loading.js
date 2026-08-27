// A minimal desk skeleton — deliberately not SkeletonPage, which assumes the
// PageShell chrome this route group doesn't have.
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
    </div>
  );
}
