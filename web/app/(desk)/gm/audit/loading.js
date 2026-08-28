// The desk paints its own frame, so the skeleton is the frame with empty
// columns rather than PageShell's stacked bars — a centred card here would
// reflow into a three-pane workspace the moment the data lands.
export default function Loading() {
  return (
    <div className="desk-shell">
      <header className="desk-header">
        <h1 className="text-base">Audit</h1>
      </header>
      <div className="desk-body">
        <div className="desk-rail" />
        <main className="desk-main">
          <p className="text-muted text-sm">Reading the log…</p>
        </main>
        <aside className="desk-inspector" />
      </div>
    </div>
  );
}
