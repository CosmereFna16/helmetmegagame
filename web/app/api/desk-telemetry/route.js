// TEMPORARY DIAGNOSTIC sink for useReloadTelemetry.js — one console.log per
// beacon so the desks' reload reports land in Railway's service logs, where
// they can be read next to the edge's HTTP logs. No database, no auth (the
// payload is a client-composed diagnostic, size-capped, logged verbatim and
// trusted for nothing). Remove together with useReloadTelemetry.js.
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const text = (await request.text()).slice(0, 4096);
    console.log("[desk-telemetry]", text);
  } catch {
    /* a malformed beacon is not worth an error */
  }
  return new Response(null, { status: 204 });
}
