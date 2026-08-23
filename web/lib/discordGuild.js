import { cache } from "react";
import { auth } from "@/lib/auth";
import {
  prisma,
  hashNameToColor,
  formatBareName,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  PLAYER_ROLE_ID,
} from "@lifeweb/db";
import { recordArchiveEvent } from "@lifeweb/db/lib/archive";

const DISCORD_API = "https://discord.com/api/v10";

// Channels opt into summary/tupper behavior by name instead of a manually
// curated ID list — see bot/src/lib/channels.js for the bot-side twin of
// this logic (kept separate since the bot uses its gateway cache instead
// of a REST call).
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_FORUM = 15;
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Tupper/summary status is Location-channel-ID-based (see
// getLocationChannelIds below) — a channel opts in by being one of a
// Location's plain/public/private channels, provisioned via
// web/app/(app)/gm/dev/actions.js#provisionLocationChannels — plus the two
// narrowcast channels (#radio, #intercom), which are tupper-only, never
// summary: they aren't tied to a place, so there's no Location adjudication
// result to post there.
export function isSummaryChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT) return false;
  return locationChannelIds?.tupperSummary?.has(channel.id) ?? false;
}

export function isTupperChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT && channel.type !== CHANNEL_TYPE_FORUM) return false;
  return (
    (locationChannelIds?.tupperSummary?.has(channel.id) || locationChannelIds?.tupperOnly?.has(channel.id)) ?? false
  );
}

const locationChannelCache = ttlCache(30_000);

async function fetchLocationChannelIds() {
  const [locations, config] = await Promise.all([
    prisma.location.findMany({
      select: { discordChannelId: true, discordPublicChannelId: true, discordPrivateChannelId: true },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  for (const loc of locations) {
    if (loc.discordChannelId) tupperSummary.add(loc.discordChannelId);
    if (loc.discordPublicChannelId) tupperSummary.add(loc.discordPublicChannelId);
    if (loc.discordPrivateChannelId) tupperOnly.add(loc.discordPrivateChannelId);
  }
  if (config?.radioChannelId) tupperOnly.add(config.radioChannelId);
  if (config?.intercomChannelId) tupperOnly.add(config.intercomChannelId);
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

const memberCache = ttlCache(5 * 60_000);
const memberListCache = ttlCache(5 * 60_000);

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
    return members.map((m) => ({ id: m.user.id, username: m.user.username, roles: m.roles ?? [] }));
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

// Whether this member is cleared to roll a character at all. Paired with
// GameConfig.openToPlayers: the config says the doors are open, this says
// you are on the list. Same env-gated shape as isGm/isCursed above.
//
// The role ID is hardcoded (db/lib/roleIds.js) rather than env-configured,
// precisely because this gate fails CLOSED: an unset env var would have meant
// a deploy that silently locked every player out, with nothing in the UI to
// explain why. There is one correct value and it lives in the repo.
export function isApprovedPlayer(member) {
  if (!member) return false;
  return member.roles?.includes(PLAYER_ROLE_ID) ?? false;
}

export function isCursed(member) {
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!member || !cursedRoleId) return false;
  return member.roles?.includes(cursedRoleId) ?? false;
}

// Shared auth+role lookup for both pages (which redirect on failure) and
// server actions (which throw) — callers decide what "not allowed" means.
export const getGmSession = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return { session: null, isGm: false };
  const member = await getGuildMember(session.discordUserId);
  return { session, isGm: isGm(member) };
});

// The two requests every DM costs. Both honour Discord's `retry_after` on a
// 429, matching db/lib/discordRest.js#discordRequest — the REST twin that has
// always had it. Without this a rate-limited DM threw and, at the one caller
// that swallowed its errors, vanished. Opening a DM channel is the tighter of
// the two limits, since a GM broadcast opens one per recipient.
const DM_429_RETRIES = 3;

async function dmFetch(url, body, describe) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");

  for (let attempt = 0; attempt <= DM_429_RETRIES; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && attempt < DM_429_RETRIES) {
      const retryAfter = Number((await res.json().catch(() => ({}))).retry_after) || 1;
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!res.ok) throw new Error(`${describe}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  throw new Error(`${describe}: exhausted retries on 429`);
}

export async function createDmChannel(discordUserId) {
  return dmFetch(
    `${DISCORD_API}/users/@me/channels`,
    { recipient_id: discordUserId },
    "Failed to open DM channel",
  );
}

export async function postMessage(channelId, content) {
  return dmFetch(
    `${DISCORD_API}/channels/${channelId}/messages`,
    { content },
    "Failed to post message",
  );
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
//
// `characterName` is the BARE name (first + last, via formatBareName) at every
// call site, never the displayed one. The 32-char cap is shared between the
// two halves — about 14 each — so an honorific and a quoted title would
// truncate the result to garbage. This is the one surface where a title
// deliberately does not appear; bot/src/lib/nickname.js does the same.
export async function syncCharacterNickname(discordUserId, characterName, preferredNickname) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return;

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

// Called right after a player toggles "Disable Romance Content?" on their
// character sheet, same pattern/reasoning as setTurnPingRole above — no
// bot-side resync, this is the only place it ever changes.
export async function setRomanceOptOutRole(discordUserId, optOut) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_NO_ROMANCE_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  const method = optOut ? "PUT" : "DELETE";
  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
      { method, headers: { Authorization: `Bot ${token}` } },
    );
    if (!res.ok && res.status !== 204) {
      console.error(`Failed to ${optOut ? "add" : "remove"} no-romance role for ${discordUserId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Failed to ${optOut ? "add" : "remove"} no-romance role for ${discordUserId}:`, err);
  }
}

// Granted automatically by killCharacter on death, removed automatically by
// createCharacter once the cursed player successfully rolls a new one. A GM
// clearing the curse early (body buried / rites read) is now just removing
// the role directly in Discord — there's no app-side "uncurse" action.
export async function grantCursedRole(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
      { method: "PUT", headers: { Authorization: `Bot ${token}` } },
    );
    if (!res.ok && res.status !== 204) {
      console.error(`Failed to grant cursed role to ${discordUserId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Failed to grant cursed role to ${discordUserId}:`, err);
  }
}

export async function removeCursedRole(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
      { method: "DELETE", headers: { Authorization: `Bot ${token}` } },
    );
    if (!res.ok && res.status !== 204) {
      console.error(`Failed to remove cursed role from ${discordUserId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Failed to remove cursed role from ${discordUserId}:`, err);
  }
}

// Personal Discord role titled after this character's name, colored
// deterministically by db/lib/roleColor.js#hashNameToColor from that same
// bare name. Creates+assigns
// the role the first time a character gets a name; every later call
// (idempotent, safe to call on every profile save) renames/recolors it to
// match the character's current name. Called as a best-effort side effect
// from updateCharacterProfile and updateCharacterRaw, same convention as
// syncCharacterNickname above.
export async function ensureCharacterRole(character) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  // Bare (first + last), never the displayed name: the role is an
  // @-mentionable access primitive, not an RP surface, and seeding both the
  // name and the colour off the bare string means granting or changing a
  // title never renames or recolours anyone.
  const bare = formatBareName(character);
  if (!guildId || !token || !bare) return character.discordRoleId ?? null;

  const color = hashNameToColor(bare);

  try {
    if (!character.discordRoleId) {
      const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: bare, color, hoist: false, mentionable: true }),
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
      body: JSON.stringify({ name: bare, color }),
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

// Deletes a character's personal Discord role outright — Discord itself
// drops any channel permission overwrites tied to the role (Location
// categories) the moment the role is deleted, so this alone undoes
// ensureCharacterRole/syncCharacterLocationAccess without needing to touch
// those channels individually. Used by
// wipeGameData (web/app/(app)/gm/dev/actions.js) when deleting a character
// outright, not by any per-character edit flow.
export async function deleteCharacterRole(discordRoleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token || !discordRoleId) return;

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles/${discordRoleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      console.error(`Failed to delete role ${discordRoleId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Failed to delete role ${discordRoleId}:`, err);
  }
}

// REST twin of bot/src/lib/location.js#swapLocationAccess, for GM raw edits
// (updateCharacterRaw, web/app/(app)/gm/dev/actions.js) which change
// Character.locationId directly in the DB with no gateway Guild object on
// hand. Same single-overwrite-per-active-Location primitive: grant ViewChannel
// on the new category, revoke it on the old one.
export async function syncCharacterLocationAccess(discordRoleId, oldLocationId, newLocationId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !discordRoleId || oldLocationId === newLocationId) return;

  const [oldLocation, newLocation] = await Promise.all([
    oldLocationId ? prisma.location.findUnique({ where: { id: oldLocationId } }) : null,
    newLocationId ? prisma.location.findUnique({ where: { id: newLocationId } }) : null,
  ]);

  if (oldLocation?.discordCategoryId) {
    await fetch(`${DISCORD_API}/channels/${oldLocation.discordCategoryId}/permissions/${discordRoleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${token}` },
    }).catch(() => {});
  }
  if (newLocation?.discordCategoryId) {
    await fetch(`${DISCORD_API}/channels/${newLocation.discordCategoryId}/permissions/${discordRoleId}`, {
      method: "PUT",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: discordRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL) }),
    }).catch(() => {});
  }
}

// Reconciles a character's personal-role permission overwrites on the two
// hardcoded narrowcast channels (#radio, #intercom) against their current
// tags and Location/Zone — see db/lib/narrowcastAccess.js for the actual
// rules, and bot/src/lib/location.js's twin of the same name (gateway-based,
// called after every Move) for the other half. This one is the REST path,
// called from GM raw location/tag edits and from character creation.
// Idempotent — safe to call after any tag or location change.
export async function syncCharacterNarrowcastAccess(characterId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !characterId) return;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { discordRoleId: true },
  });
  if (!character?.discordRoleId) return;

  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);
  const channelIds = { radio: config?.radioChannelId, intercom: config?.intercomChannelId };

  await Promise.all(
    Object.entries(channelIds)
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const grant = access[slug];
        try {
          if (grant) {
            let allow = 0;
            if (grant.view || grant.send) allow |= PERM_VIEW_CHANNEL;
            if (grant.send) allow |= PERM_SEND_MESSAGES;
            const res = await fetch(`${DISCORD_API}/channels/${channelId}/permissions/${character.discordRoleId}`, {
              method: "PUT",
              headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ id: character.discordRoleId, type: 0, allow: String(allow), deny: "0" }),
            });
            if (!res.ok) {
              console.error(`Failed to grant narrowcast access on ${slug} for ${characterId}: ${res.status} ${await res.text()}`);
            }
          } else {
            const res = await fetch(`${DISCORD_API}/channels/${channelId}/permissions/${character.discordRoleId}`, {
              method: "DELETE",
              headers: { Authorization: `Bot ${token}` },
            });
            if (!res.ok && res.status !== 404) {
              console.error(`Failed to revoke narrowcast access on ${slug} for ${characterId}: ${res.status} ${await res.text()}`);
            }
          }
        } catch (err) {
          console.error(`Narrowcast sync failed for ${slug}/${characterId}:`, err);
        }
      }),
  );
}

// Removes one permission overwrite. 404 is success — "there is no overwrite
// for this target" is the state the caller wanted.
async function deleteOverwrite(channelId, targetId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !channelId || !targetId) return;
  await fetch(`${DISCORD_API}/channels/${channelId}/permissions/${targetId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${token}` },
  }).catch(() => {});
}

// Strips every channel-viewing grant a character holds, anywhere in the guild.
//
// Deleting the personal role used to be enough on its own: Discord drops every
// overwrite tied to a role the moment the role goes. That is true only while
// access is keyed on the role. It stops being true the moment any grant is
// keyed on the *member* instead — a member overwrite is not tied to the role
// and outlives it, which would leave a dead character's player still seeing
// the room they died in. So the revoke is explicit here rather than a side
// effect of role deletion, and it clears BOTH keys: the role id for today's
// model, the Discord user id for the per-member one. Deleting an overwrite
// that isn't there is a 404, i.e. free.
//
// It sweeps every Location category, not just the character's current one. A
// grant should only ever exist on the room they are standing in, but a
// half-failed swapLocationAccess leaves one behind on the room they left, and
// death is exactly the wrong moment to trust that invariant. Death is rare and
// the walk is sequential, so the cost is a few dozen requests on an event that
// happens a handful of times a game.
export async function revokeAllCharacterAccess(character) {
  const targetIds = [character.discordRoleId, character.discordUserId].filter(Boolean);
  if (targetIds.length === 0) return;

  const [locations, config] = await Promise.all([
    prisma.location.findMany({
      where: { discordCategoryId: { not: null } },
      select: { discordCategoryId: true, discordChannelId: true, discordPublicChannelId: true, discordPrivateChannelId: true },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);

  // The category is the access primitive, but a channel that has been
  // desynced from its category carries its own overwrites — so clear the
  // children too rather than assuming the category covers them.
  const channelIds = [];
  for (const location of locations) {
    channelIds.push(
      location.discordCategoryId,
      location.discordChannelId,
      location.discordPublicChannelId,
      location.discordPrivateChannelId,
    );
  }
  channelIds.push(config?.radioChannelId, config?.intercomChannelId);

  for (const channelId of channelIds.filter(Boolean)) {
    for (const targetId of targetIds) {
      await deleteOverwrite(channelId, targetId);
    }
  }
}

// Everything that has to happen in Discord when a character dies, plus
// granting the Cursed role. Called from updateCharacterRaw whenever status
// transitions TO DEAD.
//
// Order matters: revoke before the role is deleted and before discordRoleId is
// nulled, since both are needed to name the overwrites being removed.
export async function killCharacter(character) {
  await revokeAllCharacterAccess(character).catch((err) =>
    console.error(`Failed to revoke access for dead character ${character.id}:`, err),
  );

  if (character.discordRoleId) {
    await deleteCharacterRole(character.discordRoleId).catch(() => {});
    await prisma.character
      .update({ where: { id: character.id }, data: { discordRoleId: null } })
      .catch(() => {});
  }

  await updateGuildNickname(character.discordUserId, null).catch(() => {});

  await grantCursedRole(character.discordUserId);

  await recordArchiveEvent(prisma, {
    kind: "DEATH",
    character,
    locationId: character.locationId ?? null,
    content: `${character.name} died.`,
  });
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

// Re-sorts every provisioned Location's category alphabetically by
// "{Zone} / {Location}" (zone first, then location within it), called after
// provisionLocationChannels creates a new one so the category list doesn't
// need manual reordering in Discord. Only reassigns position values among
// the category IDs that are already Location categories — every other
// category (admin/GM channels, defaults) keeps whatever position it already
// has, since Discord's bulk endpoint only touches entries you include.
export async function sortLocationCategories() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return;

  const locations = await prisma.location.findMany({
    where: { discordCategoryId: { not: null } },
    include: { zone: true },
  });
  if (locations.length === 0) return;

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) return;
  const channels = await res.json();

  const locationCategoryIds = new Set(locations.map((l) => l.discordCategoryId));
  const currentPositions = channels
    .filter((c) => c.type === CHANNEL_TYPE_CATEGORY && locationCategoryIds.has(c.id))
    .map((c) => c.position)
    .sort((a, b) => a - b);

  const sorted = [...locations].sort((a, b) =>
    `${a.zone.name} / ${a.name}`.localeCompare(`${b.zone.name} / ${b.name}`),
  );
  const updates = sorted.map((l, i) => ({ id: l.discordCategoryId, position: currentPositions[i] }));

  await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }).catch(() => {});
}

export async function sendDm(discordUserId, content) {
  const channel = await createDmChannel(discordUserId);
  const formatted = `» ${content}`;
  const message = await postMessage(channel.id, formatted);
  await prisma.directMessage
    .create({ data: { discordUserId, direction: "OUTBOUND", content: formatted } })
    .catch(() => {});
  return message;
}
