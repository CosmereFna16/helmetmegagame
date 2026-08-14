const DISCORD_API = "https://discord.com/api/v10";

export async function getGuildMember(discordUserId) {
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

export async function listGuildMembers() {
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

export function isGm(member) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!member || !gmRoleId) return false;
  return member.roles?.includes(gmRoleId) ?? false;
}

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

export async function sendDm(discordUserId, content) {
  const channel = await createDmChannel(discordUserId);
  return postMessage(channel.id, content);
}
