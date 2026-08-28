import { SkeletonBar } from "@/app/components/PageShell";

// Not SkeletonPage: this route group has no PageShell chrome to imitate, the
// same reason /gm/turns hand-rolls its own.
export default function Loading() {
  return (
    <main className="desk-main">
      <div className="animate-pulse flex flex-col gap-3">
        <SkeletonBar width="30%" />
        <SkeletonBar width="100%" />
        <SkeletonBar width="100%" />
        <SkeletonBar width="100%" />
      </div>
    </main>
  );
}
