import { SkeletonBar } from "@/app/components/PageShell";

// Renders inside the desk shell layout.js already painted — the rail doesn't
// re-suspend when you pick a different person — so this fills the person view
// only, not a whole page.
export default function Loading() {
  return (
    <div className="desk-person">
      <div className="desk-convo">
        <div className="desk-convo-thread animate-pulse flex flex-col gap-3">
          <SkeletonBar width="40%" />
          <SkeletonBar width="80%" />
          <SkeletonBar width="55%" />
          <SkeletonBar width="90%" />
          <SkeletonBar width="45%" />
        </div>
      </div>
      <aside className="desk-dossier">
        <div className="desk-dossier-body animate-pulse flex flex-col gap-3">
          <SkeletonBar width="60%" />
          <SkeletonBar width="45%" />
        </div>
      </aside>
    </div>
  );
}
