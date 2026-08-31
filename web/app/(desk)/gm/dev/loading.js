import { SkeletonBar } from "@/app/components/PageShell";

// Not SkeletonPage: this route has no PageShell chrome to imitate — same
// reasoning as (desk)/gm/players/loading.js.
export default function Loading() {
  return (
    <div className="desk-shell">
      <div className="desk-header">
        <SkeletonBar width="20%" />
      </div>
      <div className="desk-body desk-body--ops">
        <div className="ops-nav">
          <div className="animate-pulse flex flex-col gap-3">
            <SkeletonBar width="60%" />
            <SkeletonBar width="80%" />
            <SkeletonBar width="70%" />
          </div>
        </div>
        <main className="ops-main">
          <div className="animate-pulse flex flex-col gap-3">
            <SkeletonBar width="30%" />
            <SkeletonBar width="100%" />
            <SkeletonBar width="100%" />
            <SkeletonBar width="100%" />
          </div>
        </main>
      </div>
    </div>
  );
}
