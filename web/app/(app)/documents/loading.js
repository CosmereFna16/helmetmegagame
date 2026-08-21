import { SkeletonPage } from "../../components/PageShell";

export default function Loading() {
  return (
    <SkeletonPage
      width="wide"
      title="Documents"
      panels={[[60, 100, 90], [55, 100, 85], [65, 95, 80]]}
    />
  );
}
