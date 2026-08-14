const DISCORD_API = "https://discord.com/api/v10";

export async function getGuildMember(discordUserId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;

  const res = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`,
    { headers: { Authorization: `Bot ${token}` }, cache: "no-store" },
  );

  if (!res.ok) return null;
  return res.json();
}

export function isGm(member) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!member || !gmRoleId) return false;
  return member.roles?.includes(gmRoleId) ?? false;
}
