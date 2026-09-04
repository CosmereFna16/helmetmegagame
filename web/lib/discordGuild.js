import { cache } from "react";
import { auth } from "@/lib/auth";
import {
  prisma,
  characterRoleAppearance,
  formatBareName,
  CATATONIC_SLUG,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  PLAYER_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  SPECIAL_CHANNELS,
} from "@lifeweb/db";
import { applyDeathToRow } from "@lifeweb/db/lib/characterDeath";
import {
  revokeAllCharacterAccess as revokeAllCharacterAccessShared,
  revokeAccessForCharacters as revokeAccessForCharactersShared,
} from "@lifeweb/db/lib/accessSweep";
import {
  putChannelOverwrite,
  deleteChannelOverwrite,
  discordRequest,
  postDmBatched,
} from "@lifeweb/db/lib/discordRest";

// Channels opt into summary/tupper behavior by id — see bot/src/lib/channels.js
// for the bot-side twin (kept separate since the bot uses its gateway cache).
const CHANNEL_TYPE_TEXT = 0;
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Tupper/summary status is channel-ID-based (getLocationChannelIds below).
// Since Bascinet 2 the tupper set is every Location channel plus each zone's
// #summary; #summary is also the channel a zone's summaries post to.
// #cerberon is tupper-only (no zone to summarize into).
export function isSummaryChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT) return false;
  return locationChannelIds?.tupperSummary?.has(channel.id) ?? false;
}

export function isTupperChannel(channel, locationChannelIds) {
  if (channel.type !== CHANNEL_TYPE_TEXT) return false;
  return (
    (locationChannelIds?.tupperSummary?.has(channel.id) || locationChannelIds?.tupperOnly?.has(channel.id)) ?? false
  );
}

const locationChannelCache = ttlCache(30_000);

async function fetchLocationChannelIds() {
  const [zones, locations, config] = await Promise.all([
    prisma.zone.findMany({ select: { discordSummaryChannelId: true } }),
    prisma.location.findMany({ select: { discordChannelId: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  for (const zone of zones) {
    if (zone.discordSummaryChannelId) tupperSummary.add(zone.discordSummaryChannelId);
  }
  for (const location of locations) {
    if (location.discordChannelId) tupperOnly.add(location.discordChannelId);
  }
  for (const entry of SPECIAL_CHANNELS) {
    if (entry.tupper && config?.[entry.configKey]) tupperOnly.add(config[entry.configKey]);
  }
  return { tupperSummary, tupperOnly };
}

export const getLocationChannelIds = cache(async () => {
  const cached = locationChannelCache.get("all");
  if (cached !== undefined) return cached;
  const value = await fetchLocationChannelIds();
  locationChannelCache.set("all", value);
  return value;
});

// Per-key TTL cache so repeated Discord lookups across navigations don't
// each cost a round trip. Fine at this scale (one Railway instance).
function ttlCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return undefined;
      return entry.value;
    },
    // getStale: only for the failure path — serving a stale value beats both
    // inventing null (silently demotes a GM) and throwing (500s every player).
    getStale(key) {
      const entry = store.get(key);
      return entry ? entry.value : undefined;
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
  };
}

const memberCache = ttlCache(5 * 60_000);
const memberListCache = ttlCache(5 * 60_000);

// In-flight dedup, keyed the same way as the TTL cache. At turn open ~120
// players arrive within seconds with cold keys; sharing the promise collapses
// concurrent misses for the same key into one call.
const inFlight = new Map();

function dedupe(key, run) {
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// Does NOT swallow errors into null: a 429 must stay distinguishable from
// "not in the guild", or a rate-limited GM gets silently bounced from /gm.
async function fetchGuildMember(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;

  return discordRequest(`/guilds/${guildId}/members/${discordUserId}`, { allow404: true });
}

export const getGuildMember = cache(async (discordUserId) => {
  const cached = memberCache.get(discordUserId);
  if (cached !== undefined) return cached;

  try {
    const value = await dedupe(`member:${discordUserId}`, () => fetchGuildMember(discordUserId));
    memberCache.set(discordUserId, value);
    return value;
  } catch (err) {
    // Reuse the last known answer on a rate limit / outage; only degrade to
    // null once nothing has ever been cached for this user.
    const stale = memberCache.getStale(discordUserId);
    if (stale !== undefined) {
      console.error(`Guild member lookup failed for ${discordUserId}, serving stale: ${err.message}`);
      return stale;
    }
    console.error(`Guild member lookup failed for ${discordUserId}, no cached value: ${err.message}`);
    return null;
  }
});

async function fetchGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return [];

  const members = await discordRequest(`/guilds/${guildId}/members?limit=1000`);
  return members.map((m) => ({
    id: m.user.id,
    username: m.user.username,
    globalName: m.user.global_name ?? null,
    avatar: m.user.avatar ?? null,
    roles: m.roles ?? [],
  }));
}

export const listGuildMembers = cache(async () => {
  const cached = memberListCache.get("all");
  if (cached !== undefined) return cached;
  try {
    const value = await dedupe("memberList", fetchGuildMembers);
    memberListCache.set("all", value);
    return value;
  } catch (err) {
    const stale = memberListCache.getStale("all");
    console.error(`Guild member list failed${stale ? ", serving stale" : ""}: ${err.message}`);
    return stale ?? [];
  }
});

const channelListCache = ttlCache(30_000);

async function fetchGuildChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return [];

  return discordRequest(`/guilds/${guildId}/channels`);
}

export const listGuildChannels = cache(async () => {
  const cached = channelListCache.get("all");
  if (cached !== undefined) return cached;
  try {
    const value = await dedupe("channelList", fetchGuildChannels);
    channelListCache.set("all", value);
    return value;
  } catch (err) {
    const stale = channelListCache.getStale("all");
    console.error(`Guild channel list failed${stale ? ", serving stale" : ""}: ${err.message}`);
    return stale ?? [];
  }
});

export function isGm(member) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!member || !gmRoleId) return false;
  return member.roles?.includes(gmRoleId) ?? false;
}

// Role ID hardcoded rather than env-configured: this gate fails CLOSED, so a
// missing env var would silently lock every player out.
export function isApprovedPlayer(member) {
  if (!member) return false;
  return member.roles?.includes(PLAYER_ROLE_ID) ?? false;
}

export function isCursed(member) {
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!member || !cursedRoleId) return false;
  return member.roles?.includes(cursedRoleId) ?? false;
}

export function isLeaderWhitelisted(member) {
  if (!member) return false;
  return member.roles?.includes(LEADER_WHITELIST_ROLE_ID) ?? false;
}

export async function listGmMembers() {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId) return [];
  const members = await listGuildMembers();
  return members.filter((m) => m.roles.includes(gmRoleId));
}

// Shared auth+role lookup for pages (redirect on failure) and server
// actions (throw) — callers decide what "not allowed" means.
export const getGmSession = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return { session: null, isGm: false };
  const member = await getGuildMember(session.discordUserId);
  return { session, isGm: isGm(member) };
});

export async function deleteMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    allow404: true,
  });
}

const NICK_MAX = 32;
const NICK_SEP = " | ";

// Kept in sync by hand with the identical function in bot/src/lib/nickname.js.
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
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}`, {
      method: "PATCH",
      body: { nick: nickname },
      allow404: true,
    });
  } catch (err) {
    console.error(`Failed to set nickname for ${discordUserId}:`, err);
  }
}

// `characterName` is always the BARE name (formatBareName). The 32-char cap
// is shared between the two halves, so a title never appears here.
export async function syncCharacterNickname(discordUserId, characterName) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return;

  const member = await getGuildMember(discordUserId);
  if (!member) return;

  const base = member.user.global_name || member.user.username;
  await updateGuildNickname(discordUserId, buildNickname(base, characterName));
}

export async function setTurnPingRole(discordUserId, optIn) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  const method = optIn ? "PUT" : "DELETE";
  try {
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method,
      allow404: true,
    });
  } catch (err) {
    console.error(`Failed to ${optIn ? "add" : "remove"} turn-ping role for ${discordUserId}:`, err);
  }
}

// Granted by killCharacter on death; removed by createCharacter on re-roll,
// or by a BURY_CHARACTER request. A GM can also clear it by hand in Discord.
export async function grantCursedRole(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const roleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!guildId || !token || !roleId) return;

  try {
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method: "PUT",
      allow404: true,
    });
    memberCache.delete(discordUserId);
    memberListCache.delete("all");
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
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method: "DELETE",
      allow404: true,
    });
    memberCache.delete(discordUserId);
    memberListCache.delete("all");
  } catch (err) {
    console.error(`Failed to remove cursed role from ${discordUserId}:`, err);
  }
}

// Personal Discord role titled after this character, colored deterministically.
// Goes through db/lib/characterRoleAppearance.js so a Catatonic character's
// grey stays intact.
export async function ensureCharacterRole(character) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const bare = formatBareName(character);
  if (!guildId || !token || !bare) return character.discordRoleId ?? null;

  const catatonic =
    (await prisma.characterTag.count({
      where: { characterId: character.id, tag: { slug: CATATONIC_SLUG } },
    })) > 0;
  const { name, color } = characterRoleAppearance(bare, { catatonic });

  try {
    if (!character.discordRoleId) {
      const role = await discordRequest(`/guilds/${guildId}/roles`, {
        method: "POST",
        // permissions: "0" is NOT the API default — Discord's create-role
        // endpoint copies @everyone's permissions when the field is omitted.
        // Leaving it out gave every character role @everyone's bits, which
        // granted nothing extra (nobody holds these roles) but did make each
        // one look like a real access role to db:prune-orphan-roles, whose
        // "carries permissions" gate then refused to ever delete one.
        body: { name, color, hoist: false, mentionable: true, permissions: "0" },
      });

      // Assigned to NOBODY on purpose: it's a mentionable name token with no
      // permissions of its own. Access rides the zone role instead.
      await prisma.character.update({ where: { id: character.id }, data: { discordRoleId: role.id } });
      return role.id;
    }

    await discordRequest(`/guilds/${guildId}/roles/${character.discordRoleId}`, {
      method: "PATCH",
      body: { name, color },
    });
    return character.discordRoleId;
  } catch (err) {
    console.error("ensureCharacterRole failed:", err);
    return character.discordRoleId ?? null;
  }
}

// Does NOT revoke channel access (a per-member overwrite, not the role) —
// callers must pair this with revokeAllCharacterAccess.
export async function deleteCharacterRole(discordRoleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token || !discordRoleId) return;

  await discordRequest(`/guilds/${guildId}/roles/${discordRoleId}`, {
    method: "DELETE",
    allow404: true,
  });
}

// Reconciles per-member overwrites on #cerberon against current tags
// and Zone (see db/lib/specialChannels.js). Every location change goes through
// db/lib/locationMove.js#applyLocationMoveSideEffects instead, which does this
// and the two role swaps in one place; this stays for the tag-change callers.
export async function syncCharacterNarrowcastAccess(characterId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !characterId) return;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { discordUserId: true },
  });
  if (!character?.discordUserId) return;

  const [ctx, config] = await Promise.all([
    buildNarrowcastContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const access = computeNarrowcastAccess(ctx);

  await Promise.all(
    SPECIAL_CHANNELS.map((entry) => [entry.slug, config?.[entry.configKey]])
      .filter(([, channelId]) => channelId)
      .map(async ([slug, channelId]) => {
        const grant = access[slug];
        try {
          if (grant) {
            let allow = 0;
            if (grant.view || grant.send) allow |= PERM_VIEW_CHANNEL;
            if (grant.send) allow |= PERM_SEND_MESSAGES;
            await putChannelOverwrite(channelId, character.discordUserId, {
              allow: String(allow),
              type: 1,
            });
          } else {
            await deleteChannelOverwrite(channelId, character.discordUserId);
          }
        } catch (err) {
          console.error(`Narrowcast sync failed for ${slug}/${characterId}:`, err);
        }
      }),
  );
}

export async function revokeAllCharacterAccess(character) {
  return revokeAllCharacterAccessShared(prisma, character);
}

export async function revokeAccessForCharacters(characters) {
  return revokeAccessForCharactersShared(prisma, characters);
}

// Order matters: revoke access, then delete the role, before nulling
// discordRoleId — both are needed to name the overwrites removed.
export async function killCharacter(character, reason = null) {
  await revokeAllCharacterAccess(character).catch((err) =>
    console.error(`Failed to revoke access for dead character ${character.id}:`, err),
  );

  if (character.discordRoleId) {
    await deleteCharacterRole(character.discordRoleId).catch(() => {});
  }

  await updateGuildNickname(character.discordUserId, null).catch(() => {});

  // Shared with the turn engine's catatonic death pass (characterDeath.js)
  // so the two death paths can't drift.
  await applyDeathToRow(prisma, character, {
    expectStatus: "DEAD",
    content: `${character.name} died.`,
  }).catch((err) => console.error(`Death row cleanup failed for ${character.id}:`, err));

  await grantCursedRole(character.discordUserId);

  await sendDm(character.discordUserId, `You have died.${reason?.trim() ? `\n${reason.trim()}` : ""}`, {
    source: "player_event",
  }).catch((err) => console.error(`Death DM failed for ${character.id}:`, err));
}

// Applies the `»` prefix and logs the DM so /gm/messages keeps the full
// conversation. postDmBatched splits anything over Discord's 2000-char limit;
// `opts.components` is an optional action row, placed on the LAST chunk.
export async function sendDm(discordUserId, content, opts = {}) {
  const formatted = `» ${content}`;
  const message = await postDmBatched(discordUserId, formatted, opts.components);
  await prisma.directMessage
    .create({
      data: {
        discordUserId,
        direction: "OUTBOUND",
        content: formatted,
        authorDiscordUserId: opts.authorDiscordUserId ?? null,
        source: opts.source ?? null,
        discordMessageId: message?.id ?? null,
        meta: opts.meta ?? undefined,
      },
    })
    .catch(() => {});
  return message;
}
