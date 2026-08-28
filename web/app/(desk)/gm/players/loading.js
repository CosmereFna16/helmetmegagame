import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage title="Messages" panels={[[50], [100, 100, 100]]} />;
}
