import { NextResponse } from "next/server";

// TEMPORARY diagnostic, deleted once web/lib/auth.js resolves its own origin.
// Behind Railway's proxy the /api/auth/* route handler saw an origin of
// https://localhost:8080, which broke the OAuth redirect_uri. This reports the
// inputs a fix would have to rely on, so the fix is written against facts
// rather than a guess.
//
// Deliberately narrow: host-resolution values only. Never cookies, never
// `authorization`, never the whole header set.
export const dynamic = "force-dynamic";

export async function GET(request) {
  return NextResponse.json({
    headers: {
      "x-forwarded-host": request.headers.get("x-forwarded-host"),
      "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
      host: request.headers.get("host"),
    },
    requestUrl: request.url,
    nextUrlOrigin: request.nextUrl?.origin ?? null,
  });
}
