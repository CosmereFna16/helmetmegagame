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
  addMemberRole,
  removeMemberRole,
} from "@lifeweb/db/lib/discordRest";

// Channels opt into summary/tupper behavior by name instead of a manually
// curated ID list — see bot/src/lib/channels.js for the bot-side twin of
// this logic (kept separate since the bot uses its gateway cache instead
// of a REST call).
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_FORUM = 15;
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;

// Tupper/summary status is channel-ID-based (see getLocationChannelIds
// below) — a channel opts in by being one of a Zone's summary/public/private
// channels, provisioned by the YAML sync (db/lib/syncZones.js) — plus the two
// narrowcast channels (#watch, #intercom), which are tupper-only, never
// summary: they aren't tied to a place, so there's no zone adjudication
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
  const [zones, config] = await Promise.all([
    prisma.zone.findMany({
      select: {
        discordSummaryChannelId: true,
        discordPublicChannelId: true,
        discordPrivateChannelId: true,
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const tupperSummary = new Set();
  const tupperOnly = new Set();
  for (const zone of zones) {
    if (zone.discordSummaryChannelId) tupperSummary.add(zone.discordSummaryChannelId);
    if (zone.discordPublicChannelId) tupperSummary.add(zone.discordPublicChannelId);
    if (zone.discordPrivateChannelId) tupperOnly.add(zone.discordPrivateChannelId);
  }
  for (const entry of SPECIAL_CHANNELS) {
    if (entry.tupper && config?.[entry.configKey]) tupperOnly.add(config[entry.configKey]);
  }
  return { tupperSummary, tupperOnly };
}

// Pass the result to isSummaryChannel/isTupperChannel's second argument.
const getLocationChannelIds = cache(async () => {
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
    // Expired-but-remembered. Only for the failure path: when Discord is
    // rate-limiting or unreachable, serving a slightly stale role list beats
    // both of the alternatives — inventing `null` (which reads as "not a GM"
    // and silently demotes a GM mid-game) and throwing (which 500s the app
    // shell for every player over a transient blip).
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

// In-flight requests, keyed the same way as the TTL cache above.
//
// react's cache() dedupes within ONE render; the TTL cache dedupes across
// renders once a value has landed. Neither covers the gap between: at turn
// open, ~120 players arrive within seconds with cold, distinct keys, and every
// one of them starts its own Discord fetch because nothing is stored until the
// first resolves. Sharing the promise means concurrent misses for the same key
// collapse into a single call.
const inFlight = new Map();

function dedupe(key, run) {
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// Deliberately does NOT swallow errors into `null`. It used to, and that made
// a 429 indistinguishable from "this user isn't in the guild" — so a
// rate-limited GM was silently handed the player nav and bounced out of /gm.
// Only a real 404 means "not a member"; everything else throws and is handled
// by the stale-fallback in getGuildMember below.
async function fetchGuildMember(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;

  return discordRequest(`/guilds/${guildId}/members/${discordUserId}`, { allow404: true });
}

// cache() dedupes calls within one request (the app shell and a page both
// asking for the same user in the same render); the TTL layer underneath
// also reuses the result across separate navigations for a short window.
export const getGuildMember = cache(async (discordUserId) => {
  const cached = memberCache.get(discordUserId);
  if (cached !== undefined) return cached;

  try {
    const value = await dedupe(`member:${discordUserId}`, () => fetchGuildMember(discordUserId));
    memberCache.set(discordUserId, value);
    return value;
  } catch (err) {
    // Rate-limited or unreachable. Reuse the last known answer for this user
    // if we have one; only when we have never successfully looked them up does
    // this degrade to null, and at that point "not a GM" is the honest answer
    // rather than a guess.
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
  // globalName and avatar are here for /gm/gamemasters, the app's only
  // surface that shows a Discord identity rather than a character's.
  // Additive — every existing consumer reads by key.
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
    // Same stale-over-empty reasoning as getGuildMember: an empty roster makes
    // /gm/players look like the guild emptied out.
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

// Whether this member may pick a role that grants a faction Leader seat. Same
// hardcoded-ID reasoning as isApprovedPlayer: this gate also fails closed, and
// silently, so there is nothing to half-configure.
export function isLeaderWhitelisted(member) {
  if (!member) return false;
  return member.roles?.includes(LEADER_WHITELIST_ROLE_ID) ?? false;
}

// Everyone holding the GM role, for the Gamemasters roster. Kept here beside
// isGm so the role check is written once rather than re-derived at the page.
export async function listGmMembers() {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId) return [];
  const members = await listGuildMembers();
  return members.filter((m) => m.roles.includes(gmRoleId));
}

// Shared auth+role lookup for both pages (which redirect on failure) and
// server actions (which throw) — callers decide what "not allowed" means.
export const getGmSession = cache(async () => {
  const session = await auth();
  if (!session?.discordUserId) return { session: null, isGm: false };
  const member = await getGuildMember(session.discordUserId);
  return { session, isGm: isGm(member) };
});

// The two requests every DM costs used to be re-wrapped here as a local
// dmFetch/createDmChannel/postMessage trio. They already delegated to
// discordRequest, so all the wrapper added was a prefix on the error message —
// which cost more than it gave: rebuilding the Error dropped the `status` and
// `discordCode` that postDmBatched needs to tell a stale DM channel from a
// rate limit. Both are gone; sendDm below goes straight to the shared
// db/lib/discordRest helper, which also carries the DM-channel cache.

export async function deleteMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    allow404: true,
  });
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
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}`, {
      method: "PATCH",
      body: { nick: nickname },
      allow404: true,
    });
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
export async function syncCharacterNickname(discordUserId, characterName) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return;

  const member = await getGuildMember(discordUserId);
  if (!member) return;

  const base = member.user.global_name || member.user.username;
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
    await discordRequest(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method,
      allow404: true,
    });
  } catch (err) {
    console.error(`Failed to ${optIn ? "add" : "remove"} turn-ping role for ${discordUserId}:`, err);
  }
}

// Granted automatically by killCharacter on death, removed automatically by
// createCharacter once the cursed player successfully rolls a new one — and by
// a BURY_CHARACTER request, which is the app-side uncurse: any player standing
// where the body lies can bury it and lift the curse, which is the fiction
// docs/documents.yaml's Respawning entry has always described. A GM can still
// clear it by hand from Discord's member panel.
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
    // Both caches hold the member for five minutes; a player who re-rolls
    // inside that window would otherwise read as uncursed and keep the role.
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

// Personal Discord role titled after this character's name, colored
// deterministically from that same bare name. Creates the role the first
// time a character gets a name; every later call
// (idempotent, safe to call on every profile save) renames/recolors it to
// match the character's current name. Called as a best-effort side effect
// from updateCharacterProfile and updateCharacterRaw, same convention as
// syncCharacterNickname above.
//
// Composition goes through db/lib/characterRoleAppearance.js, never straight
// to hashNameToColor: while a character is Catatonic the Catatonic pass has
// this role reading "<name> • Catatonic" in grey, and a profile save that
// composed bare-name-plus-hash here would silently strip that.
export async function ensureCharacterRole(character) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  // Bare (first + last), never the displayed name: the role is an
  // @-mentionable access primitive, not an RP surface, and seeding both the
  // name and the colour off the bare string means granting or changing a
  // title never renames or recolours anyone.
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
        body: { name, color, hoist: false, mentionable: true },
      });

      // The role is deliberately assigned to NOBODY. It exists to be
      // @-mentioned — a name token — and holds no permissions of its own;
      // access rides the zone's own role instead (syncCharacterZoneRole,
      // below). Giving this one to the player would list their account under
      // the character's name in the guild's role members, which deanonymizes
      // the entire game.

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

// Deletes a character's personal Discord role outright.
//
// This does NOT revoke the character's channel access. It used to: while
// access was a role overwrite, Discord dropped every overwrite tied to the
// role the moment the role went, and that cascade was the only cleanup
// anything did. Access is now a per-MEMBER overwrite, which is not tied to
// the role and outlives it — so every caller must pair this with
// revokeAllCharacterAccess or leave the player still able to see the room.
// Both callers do (killCharacter here, guildMemberRemove and wipeGameData).
export async function deleteCharacterRole(discordRoleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token || !discordRoleId) return;

  // Deliberately NOT swallowed into a void: a dropped delete leaks a guild
  // role that nothing reaps, and the guild cap is 250 against ~120 live
  // characters. The caller decides what to do; wipeGameData retries.
  await discordRequest(`/guilds/${guildId}/roles/${discordRoleId}`, {
    method: "DELETE",
    allow404: true,
  });
}

// REST twin of bot/src/lib/zoneTravel.js#swapZoneRole, for GM raw edits
// (updateCharacterRaw, web/app/(app)/gm/dev/actions.js), character creation
// and the web map's travel action — paths with no gateway Guild object on
// hand. Grant BEFORE revoke, so an interrupted swap leaves the player seeing
// two zones (harmless, self-healing) rather than none. Failures are logged,
// never swallowed — the channel doctor reconciles whatever a miss leaves.
export async function syncCharacterZoneRole(discordUserId, oldZoneId, newZoneId) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !discordUserId || oldZoneId === newZoneId) return;

  const [oldZone, newZone] = await Promise.all([
    oldZoneId ? prisma.zone.findUnique({ where: { id: oldZoneId } }) : null,
    newZoneId ? prisma.zone.findUnique({ where: { id: newZoneId } }) : null,
  ]);

  if (newZone?.discordRoleId) {
    await addMemberRole(discordUserId, newZone.discordRoleId).catch((err) =>
      console.error(`Failed to grant ${discordUserId} the ${newZone.name} zone role:`, err.message),
    );
  }
  if (oldZone?.discordRoleId && oldZone.discordRoleId !== newZone?.discordRoleId) {
    await removeMemberRole(discordUserId, oldZone.discordRoleId).catch((err) =>
      console.error(`Failed to remove ${discordUserId}'s ${oldZone.name} zone role:`, err.message),
    );
  }
}

// Reconciles a character's per-member permission overwrites on the two
// hardcoded narrowcast channels (#watch, #intercom) against their current
// tags and Zone — see db/lib/specialChannels.js for the actual rules, and
// bot/src/lib/zoneTravel.js's twin of the same name (gateway-based, called
// after every Move) for the other half. This one is the REST path, called
// from the web map's travel action, GM raw zone/tag edits and character
// creation. Idempotent — safe to call after any tag or zone change.
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

// Thin prisma-binding shim over db/lib/accessSweep.js#revokeAllCharacterAccess
// — same convention as web/lib/factionPermissions.js, so web callers keep the
// shorter signature while the bot (guildMemberRemove) requires the shared one
// by path. The logic lives in db/lib because both faces need it.
export async function revokeAllCharacterAccess(character) {
  return revokeAllCharacterAccessShared(prisma, character);
}

// The bulk twin, for Restart Game. Channel-major rather than one blind sweep
// per character — see db/lib/accessSweep.js#revokeAccessForCharacters.
export async function revokeAccessForCharacters(characters) {
  return revokeAccessForCharactersShared(prisma, characters);
}

// Everything that has to happen in Discord when a character dies, plus
// granting the Cursed role. Called from updateCharacterRaw whenever status
// transitions TO DEAD.
//
// Order matters: revoke before the role is deleted and before discordRoleId is
// nulled, since both are needed to name the overwrites being removed.
//
// `reason` is optional prose from whoever pulled the trigger (a GM's Kill
// button, or the lethal-outcome path off a request) — folded into the same
// death DM rather than each caller sending its own, so a character dies with
// exactly one notification no matter which door it came through.
export async function killCharacter(character, reason = null) {
  await revokeAllCharacterAccess(character).catch((err) =>
    console.error(`Failed to revoke access for dead character ${character.id}:`, err),
  );

  if (character.discordRoleId) {
    await deleteCharacterRole(character.discordRoleId).catch(() => {});
  }

  await updateGuildNickname(character.discordUserId, null).catch(() => {});

  // The database half — discordRoleId nulled, every equipped tag cleared (a
  // corpse doesn't wield things), the DEATH archive row — is shared with the
  // turn engine's catatonic death pass (db/lib/characterDeath.js) so the two
  // death paths can't drift. expectStatus DEAD: every caller here writes the
  // status first and calls this for the cleanup.
  await applyDeathToRow(prisma, character, {
    expectStatus: "DEAD",
    content: `${character.name} died.`,
  }).catch((err) => console.error(`Death row cleanup failed for ${character.id}:`, err));

  await grantCursedRole(character.discordUserId);

  await sendDm(character.discordUserId, `You have died.${reason?.trim() ? `\n${reason.trim()}` : ""}`, {
    source: "player_event",
  }).catch((err) => console.error(`Death DM failed for ${character.id}:`, err));
}

// Applies the `»` prefix (CLAUDE.md, "Bot message style") and logs the DM, so
// /gm/messages keeps the whole conversation.
//
// postDmBatched splits anything over Discord's 2000 characters across several
// messages rather than letting the send fail. Nothing here used to check the
// length, and every GM path that lands here — a Move result, a rejection
// reason, a broadcast, a Dev Panel message — is free text a GM types. Over the
// limit Discord rejected it, the caller's .catch swallowed the error, and the
// GM watched the Move go green while the player was never told.
//
// The prefix goes on before the split, so it lands on the first message and
// the continuations run on bare.
// `opts.components` is an optional Discord action row — a DM that carries a
// button (the Bird's Reply, so far). postDmBatched puts it on the LAST chunk.
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
        // null, not "bot_auto" like the other two twins: web-app callers were
        // all GM-authored until the Caving Die's arrival roll
        // (web/app/(app)/map/travelActions.js) started sending automated DMs
        // from here too. An unlabelled row still reads as "unknown" — the
        // same reading the UI already gives pre-migration rows — so callers
        // that want a real label pass one via opts.source.
        source: opts.source ?? null,
        discordMessageId: message?.id ?? null,
        meta: opts.meta ?? undefined,
      },
    })
    .catch(() => {});
  return message;
}
