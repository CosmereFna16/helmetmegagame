import PageShell, { PageHeader, SkeletonBar } from "@/app/components/PageShell";

export default function Loading() {
  return (
    <PageShell>
      <PageHeader title="Players" />
      {/* The tab strip is part of the shape the page lands in — without a
          placeholder for it the whole table jumps down when it arrives. */}
      <div className="flex gap-4">
        <SkeletonBar width="90px" height={20} />
        <SkeletonBar width="90px" height={20} />
      </div>
      <div className="panel animate-pulse p-4">
        <div className="flex flex-col gap-3">
          {[100, 100, 100, 100, 100].map((w, i) => (
            <SkeletonBar key={i} width={`${w}%`} />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
