import { cache } from "react";
import { discordRequest } from "@lifeweb/db/lib/discordRest";

// The GM roster, with avatars, for the small pfp that sits next to any
// GM-attributed row in the web app (the lock holder on a queue row, a staged
// row's author, a request's reviewer).
//
// Separate from discordGuild.js#listGuildMembers on purpose: that one is the
// whole guild, keyed for name lookups, and it strips the per-member `avatar`
// field this needs — a GM who set a server-specific avatar should show that
// one, not their global picture.

const TTL_MS = 5 * 60_000;

// Same shape of caching as discordGuild.js: a TTL so repeated navigations
// don't each cost a round trip, one shared in-flight promise so a burst of
// concurrent misses collapses into a single call, and the expired value kept
// around as a failure fallback — a slightly stale avatar beats a page that
// throws because Discord was rate-limiting.
let entry = null;
let inFlight = null;

function avatarUrlFor(guildId, member) {
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.png?size=64`;
  }
  if (member.user.avatar) {
    return `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=64`;
  }
  return null;
}

async function fetchGmProfiles() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!process.env.DISCORD_TOKEN || !guildId || !gmRoleId) return [];

  const members = await discordRequest(`/guilds/${guildId}/members?limit=1000`);
  return members
    .filter((m) => (m.roles ?? []).includes(gmRoleId))
    .map((m) => ({
      discordUserId: m.user.id,
      username: m.user.username,
      avatarUrl: avatarUrlFor(guildId, m),
    }));
}

export const getGmProfiles = cache(async () => {
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  try {
    if (!inFlight) inFlight = fetchGmProfiles().finally(() => (inFlight = null));
    const value = await inFlight;
    entry = { value, expiresAt: Date.now() + TTL_MS };
    return value;
  } catch (err) {
    console.error(`GM profile list failed${entry ? ", serving stale" : ""}: ${err.message}`);
    return entry?.value ?? [];
  }
});
