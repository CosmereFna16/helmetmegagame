import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { NextRequest } from "next/server";

// Behind Railway's proxy Next.js builds `request.url` from the container's own
// listener — https://localhost:8080 — and ignores the Host header, even though
// Railway forwards the real host correctly. That matters because the
// /api/auth/* route handler derives the OAuth redirect_uri from the request
// URL (next-auth/lib/env.js#reqWithEnvURL), so Discord would be handed
// https://localhost:8080/api/auth/callback/discord and reject it, taking
// sign-in down on every domain at once. Rebuild the origin from the forwarded
// headers before Auth.js ever sees the request.
//
// The `signIn()`/`signOut()` server actions take a different path
// (@auth/core createActionURL, which already reads x-forwarded-host) and need
// no help — only the route handler is wrong.
//
// An origin taken from a client-controllable header is an open-redirect vector
// in an OAuth flow, so hosts are allowlisted rather than trusted. Anything
// unrecognised falls back to the canonical origin, which reproduces the old
// AUTH_URL-pinned behaviour rather than a broken one. Adding a domain means
// adding it here *and* registering `<host>/api/auth/callback/discord` in the
// Discord Developer Portal. Hardcoded for the same reason as
// `db/lib/roleIds.js` — a hostname is not a secret and there is one deployment.
const CANONICAL_ORIGIN = "https://ravenheart.quest";

const ALLOWED_HOSTS = new Set([
  "ravenheart.quest",
  "web-production-38d02.up.railway.app",
]);

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function resolveOrigin(request) {
  // x-forwarded-host can be a comma-separated chain; the first entry is the
  // originating host.
  const forwarded =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = forwarded?.split(",")[0].trim();
  if (!host) return CANONICAL_ORIGIN;

  if (LOCAL_HOST.test(host)) {
    return `${request.headers.get("x-forwarded-proto") ?? "http"}://${host}`;
  }
  if (!ALLOWED_HOSTS.has(host)) return CANONICAL_ORIGIN;

  return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
}

// Mirrors how next-auth itself rewrites a request origin, so method, headers
// and body survive the swap.
function withPublicOrigin(request) {
  const origin = resolveOrigin(request);
  const { href, origin: current } = request.nextUrl;
  if (current === origin) return request;
  return new NextRequest(href.replace(current, origin), request);
}

const nextAuth = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.id) {
        token.discordUserId = profile.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.discordUserId) {
        session.discordUserId = token.discordUserId;
      }
      return session;
    },
  },
});

export const { auth, signIn, signOut } = nextAuth;

export const handlers = {
  GET: (request) => nextAuth.handlers.GET(withPublicOrigin(request)),
  POST: (request) => nextAuth.handlers.POST(withPublicOrigin(request)),
};
