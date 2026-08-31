// The pure text-splitting half of the Discord REST layer, kept in its own
// dependency-free module so a "use client" component can import it.
//
// discordRest.js is server-only — it reads DISCORD_TOKEN, calls fetch, and
// holds the Cloudflare circuit-breaker state — so a composer that wants to
// tell a GM "this arrives as 3 messages" cannot import from there. This file
// has no requires at all, so `@lifeweb/db/lib/chunkText` resolves cleanly in
// the browser bundle. Import the deep path, never the @lifeweb/db barrel,
// which pulls in @prisma/client and node:fs (same reasoning as
// web/lib/formatTagRequirement.js).
//
// discordRest.js requires this file and re-exports chunkMessage, so every
// existing caller keeps its import path.

const DISCORD_MESSAGE_LIMIT = 2000;

// Splits text into as few ≤2000-char chunks as possible, preferring to
// break on paragraph boundaries (blank lines) and falling back to a hard
// split for any single paragraph that alone exceeds the cap.
function chunkMessage(text) {
  const paragraphs = text.split("\n\n");
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    for (let i = 0; i < paragraph.length; i += DISCORD_MESSAGE_LIMIT) {
      const piece = paragraph.slice(i, i + DISCORD_MESSAGE_LIMIT);
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length > DISCORD_MESSAGE_LIMIT) {
        if (current) chunks.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = { DISCORD_MESSAGE_LIMIT, chunkMessage };
