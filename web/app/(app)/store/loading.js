import { SkeletonPage } from "../../components/PageShell";

export default function Loading() {
  return (
    <SkeletonPage
      width="wide"
      title="Store"
      panels={[[60, 100, 90], [55, 100, 85]]}
    />
  );
}
