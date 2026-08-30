import { SkeletonBar } from "@/app/components/PageShell";

// Renders inside the desk shell layout.js already painted — neither the rail
// nor the inspector re-suspends when you pick a different person — so this
// fills the conversation only. It lost its `desk-dossier` half when the
// dossier folded into the shared inspector, which is a column of the shell
// now and paints straight through a navigation.
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
    </div>
  );
}
