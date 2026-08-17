import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma, hashNameToColor } from "@lifeweb/db";

const DISCORD_API = "https://discord.com/api/v10";

// Channels opt into summary/tupper behavior by name instead of a manually
// curated ID list — see bot/src/lib/channels.js for the bot-side twin of
// this logic (kept separate since the bot uses its gateway cache instead
// of a REST call).
const CHANNEL_MARKER = "»";
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_FORUM = 15;

// locationChannelIds (see getLocationChannelIds below) is optional so
// existing callers that don't pass it keep working unchanged — it lets a
// Location's plain/public channels (web/app/(app)/gm/dev/actions.js
// #provisionLocationChannels) opt in by Discord channel ID instead of
// needing "»" in their (auto-generated) names.
export function isSummaryChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT) return false;
  if (locationChannelIds?.tupperSummary?.has(channel.id)) return true;
  return channel.name?.includes(CHANNEL_MARKER) ?? false;
}

export function isTupperChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT && channel.type !== CHANNEL_TYPE_FORUM) return false;
  if (locationChannelIds?.tupperSummary?.has(channel.id) || locationChannelIds?.tupperOnly?.has(channel.id)) {
    return true;
  }
  return channel.name?.includes(CHANNEL_MARKER) ?? false;
}

const locationChannelCache = ttlCache(30_000);

async function fetchLocationChannelIds() {
  const locations = await prisma.location.findMany({
    select: { discordChannelId: true, discordPublicChannelId: true, discordPrivateChannelId: true },
  });
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  for (const loc of locations) {
    if (loc.discordChannelId) tupperSummary.add(loc.discordChannelId);
    if (loc.discordPublicChannelId) tupperSummary.add(loc.discordPublicChannelId);
    if (loc.discordPrivateChannelId) tupperOnly.add(loc.discordPrivateChannelId);
  }
  return { tupperSummary, tupperOnly };
}

// Pass the result to isSummaryChannel/isTupperChannel's second argument.
export const getLocationChannelIds = cache(async () => {
  const cached = locationChannelCache.get("all");
  if (cached !== undefined) return cached;
  const value = await fetchLocationChannelIds();
  locationChannelCache.set("all", value);
  return value;
});

// The single channel gameplay actually happens in — exact name match, not
// marker-based, matching the bot-side twin in bot/src/lib/channels.js.
export function isTurnsChannel(channel) {
  return channel.type === CHANNEL_TYPE_TEXT && channel.name?.toLowerCase() === "turns";
}

// A tiny in-memory TTL cache so repeated Discord lookups across navigations
// (not just within one request) don't each cost a network round trip. Fine
// at this project's scale — one Railway instance, no multi-process fan-out.
function ttlCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return undefined;
      return entry.value;
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

const memberCache = ttlCache(30_000);
const memberListCache = ttlCache(60_000);

async function fetchGuildMember(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`,
      { headers: { Authorization: `Bot ${token}` }, cache: "no-store" },
    );

    if (!res.ok) return null;
    return res.json();
  } catch {
    // A misconfigured/invalid DISCORD_TOKEN, or Discord being unreachable,
    // should degrade to "not a GM" rather than take down the whole app shell.
    return null;
  }
}

// cache() dedupes calls within one request (the app shell and a page both
// asking for the same user in the same render); the TTL layer underneath
// also reuses the result across separate navigations for a short window.
export const getGuildMember = cache(async (discordUserId) => {
  const cached = memberCache.get(discordUserId);
  if (cached !== undefined) return cached;
  const value = await fetchGuildMember(discordUserId);
  memberCache.set(discordUserId, value);
  return value;
});

async function fetchGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return [];

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members?limit=1000`,
      { headers: { Authorization: `Bot ${token}` }, cache: "no-store" },
    );

    if (!res.ok) return [];
    const members = await res.json();
    return members.map((m) => ({ id: m.user.id, username: m.user.username }));
  } catch {
    return [];
  }
}

export const listGuildMembers = cache(async () => {
  const cached = memberListCache.get("all");
  if (cached !== undefined) return cached;
  const value = await fetchGuildMembers();
  memberListCache.set("all", value);
  return value;
});

const channelListCache = ttlCache(30_000);

async function fetchGuildChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return [];

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
    });

    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export const listGuildChannels = cache(async () => {
  const cached = channelListCache.get("all");
  if (cached !== undefined) return cached;
  const value = await fetchGuildChannels();
  channelListCache.set("all", value);
  return value;
});

export function isGm(member) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!member || !gmRoleId) return false;
  return member.roles?.includes(gmRoleId) ?? false;
}

// Shared auth+role lookup for both pages (which redirect on failure) and
// server actions (which throw) — callers decide what "not allowed" means.
export const getGmSession = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return { session: null, isGm: false };
  const member = await getGuildMember(session.discordUserId);
  return { session, isGm: isGm(member) };
});

export async function createDmChannel(discordUserId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");

  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (!res.ok) {
    throw new Error(`Failed to open DM channel: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function postMessage(channelId, content) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    throw new Error(`Failed to post message: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function deleteMessage(channelId, messageId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete message: ${res.status} ${await res.text()}`);
  }
}

const STAR_EMOJI = "⭐";

// Recomputes a starred message's true reaction count straight from Discord —
// used by the archive's manual "Refresh" action so counts stay correct even
// after stars are removed (something the bot's opportunistic on-add update
// can't see) or the bot missed an update while offline.
export async function getMessageStarCount(channelId, messageId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Failed to fetch message: ${res.status} ${await res.text()}`);

  const message = await res.json();
  const reaction = message.reactions?.find((r) => r.emoji?.name === STAR_EMOJI);
  return reaction?.count ?? 0;
}

const NICK_MAX = 32;
const NICK_SEP = " | ";

// Kept in sync by hand with the identical function in bot/src/lib/nickname.js
// (same convention already used for isTupperChannel/isSummaryChannel, which
// exist independently in both processes).
export function buildNickname(base, characterName) {
  const budget = NICK_MAX - NICK_SEP.length;
  const a = (base || "").trim();
  const b = (characterName || "").trim();
  if (a.length + b.length <= budget) return `${a}${NICK_SEP}${b}`;

  const aMax = Math.ceil(budget / 2);
  const truncA = a.slice(0, Math.min(a.length, aMax));
  const truncB = b.slice(0, budget - truncA.length);
  return `${truncA}${NICK_SEP}${truncB}`;
}

export async function updateGuildNickname(discordUserId, nickname) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ nick: nickname }),
    });
    if (!res.ok) {
      console.error(`Failed to set nickname for ${discordUserId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Failed to set nickname for ${discordUserId}:`, err);
  }
}

// Called right after a character is created/renamed so the nickname reflects
// it immediately instead of waiting for the bot's next connect-time resync.
export async function syncCharacterNickname(discordUserId, characterName, preferredNickname) {
  const member = await getGuildMember(discordUserId);
  if (!member) return;

  const base = preferredNickname?.trim() || member.user.global_name || member.user.username;
  await updateGuildNickname(discordUserId, buildNickname(base, characterName));
}

// Called right after a player toggles "Turn Ping?" on their character sheet
// so the turn-ping role's membership reflects it immediately (unlike
// nicknames, there's no bot-side connect-time resync for this — it only
// ever changes via an explicit player toggle, which already fires this).
export async function setTurnPingRole(discordUserId, optIn) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  const method = optIn ? "PUT" : "DELETE";
  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
      { method, headers: { Authorization: `Bot ${token}` } },
    );
    if (!res.ok && res.status !== 204) {
      console.error(`Failed to ${optIn ? "add" : "remove"} turn-ping role for ${discordUserId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Failed to ${optIn ? "add" : "remove"} turn-ping role for ${discordUserId}:`, err);
  }
}

// Personal Discord role titled after this character's name, colored
// deterministically by db/lib/roleColor.js#hashNameToColor. Creates+assigns
// the role the first time a character gets a name; every later call
// (idempotent, safe to call on every profile save) renames/recolors it to
// match the character's current name. Called as a best-effort side effect
// from updateCharacterProfile and updateCharacterRaw, same convention as
// syncCharacterNickname above.
export async function ensureCharacterRole(character) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token || !character.name) return character.discordRoleId ?? null;

  const color = hashNameToColor(character.name);

  try {
    if (!character.discordRoleId) {
      const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: character.name, color, hoist: false, mentionable: true }),
      });
      if (!res.ok) {
        console.error(`Failed to create role for character ${character.id}: ${res.status} ${await res.text()}`);
        return null;
      }
      const role = await res.json();

      const assignRes = await fetch(
        `${DISCORD_API}/guilds/${guildId}/members/${character.discordUserId}/roles/${role.id}`,
        { method: "PUT", headers: { Authorization: `Bot ${token}` } },
      );
      if (!assignRes.ok && assignRes.status !== 204) {
        console.error(`Failed to assign role to ${character.discordUserId}: ${assignRes.status} ${await assignRes.text()}`);
      }

      await prisma.character.update({ where: { id: character.id }, data: { discordRoleId: role.id } });
      return role.id;
    }

    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles/${character.discordRoleId}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: character.name, color }),
    });
    if (!res.ok) {
      console.error(`Failed to rename/recolor role ${character.discordRoleId}: ${res.status} ${await res.text()}`);
    }
    return character.discordRoleId;
  } catch (err) {
    console.error("ensureCharacterRole failed:", err);
    return character.discordRoleId ?? null;
  }
}

const CHANNEL_TYPE_CATEGORY = 4;

// Generic channel/category creation used by provisionLocationChannels
// (web/app/(app)/gm/dev/actions.js) — a category is just this with type 4
// and no parent_id.
export async function createGuildChannel(payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) throw new Error("Discord guild is not configured.");

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to create channel "${payload.name}": ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export { CHANNEL_TYPE_CATEGORY };

export async function sendDm(discordUserId, content) {
  const channel = await createDmChannel(discordUserId);
  const formatted = `» ${content}`;
  const message = await postMessage(channel.id, formatted);
  await prisma.directMessage
    .create({ data: { discordUserId, direction: "OUTBOUND", content: formatted } })
    .catch(() => {});
  return message;
}
