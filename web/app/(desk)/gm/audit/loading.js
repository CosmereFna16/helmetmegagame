import DeskHeader from "@/app/components/DeskHeader";
import { SkeletonBar } from "@/app/components/PageShell";

// The desk paints its own frame, so the skeleton is the frame with empty
// columns rather than PageShell's stacked bars — a centred card here would
// reflow into a three-pane workspace the moment the data lands. Built on the
// same DeskHeader the real AuditDesk uses (D21's unified meta/action order)
// and AuditInspector's real empty-state root class, so the swap-in doesn't
// visibly reflow.
export default function Loading() {
  return (
    <div className="desk-shell">
      <DeskHeader
        title="Audit"
        meta={
          <>
            <SkeletonBar width="6rem" height={20} />
            <SkeletonBar width="8rem" height={20} />
          </>
        }
        actions={
          <>
            <SkeletonBar width="5rem" height={28} />
            <SkeletonBar width="3.5rem" height={28} />
          </>
        }
      />
      <div className="desk-body">
        <div className="desk-rail" />
        <main className="desk-main audit-main">
          <p className="text-muted text-sm p-3">Reading the log…</p>
        </main>
        <aside className="desk-inspector">
          <div className="desk-empty text-muted">
            <p>Pick a line to see who did it, to whom, and with what.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
