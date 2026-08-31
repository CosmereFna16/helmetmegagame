import { deployVersion } from "@/lib/deployVersion";

// The adjudication desk's pre-flight check (useDeskVersion.js): "is the
// server still the build I loaded?" Polled every 45s per open desk, so it
// deliberately touches no database and requires no session — the payload is
// a deploy id, not game state. A version that differs from the desk's own
// means a deploy landed, and the desk shows its reload chip instead of
// letting the next router.refresh() trip Next's build-mismatch fallback
// (a full, state-destroying page reload).
// GET handlers default to dynamic on this Next version, but this route
// touches no dynamic API at all — if it were ever prerendered, the version
// would bake at build time (before .next/BUILD_ID exists) and every desk
// would false-latch stale forever, silently disabling auto-refresh. One
// line makes that impossible.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { version: deployVersion() },
    { headers: { "cache-control": "no-store" } },
  );
}
