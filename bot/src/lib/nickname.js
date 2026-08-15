const { prisma } = require("@lifeweb/db");

const NICK_MAX = 32;
const SEP = " | ";

// Kept in sync by hand with the identical function in web/lib/discordGuild.js
// (same convention already used for isTupperChannel/isSummaryChannel, which
// exist independently in both processes — see CLAUDE.md).
function buildNickname(base, characterName) {
  const budget = NICK_MAX - SEP.length;
  const a = (base || "").trim();
  const b = (characterName || "").trim();
  if (a.length + b.length <= budget) return `${a}${SEP}${b}`;

  const aMax = Math.ceil(budget / 2);
  const truncA = a.slice(0, Math.min(a.length, aMax));
  const truncB = b.slice(0, budget - truncA.length);
  return `${truncA}${SEP}${truncB}`;
}

// Never uses member.nickname as the base — that's this sync's own past
// output, and feeding it back in would compound on every change.
// Returns "updated" | "skipped" | "failed" so callers can log a summary
// instead of failures disappearing into a blanket .catch(() => {}).
async function syncMemberNickname(member) {
  const character = await prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE", name: { not: "" } },
  });
  if (!character) return "skipped";

  const base = character.preferredNickname?.trim() || member.user.displayName;
  const nickname = buildNickname(base, character.name);
  if (member.nickname === nickname) return "skipped";

  try {
    await member.setNickname(nickname);
    return "updated";
  } catch (err) {
    console.error(`Failed to set nickname for ${member.user.tag} (${member.id}): ${err.message}`);
    return "failed";
  }
}

// One-time bulk catch-up (called on bot connect, alongside syncFactionsForGuild)
// for whatever drifted while the bot was offline — not a recurring poll.
async function syncNicknamesForGuild(guild) {
  await guild.members.fetch();
  const results = { updated: 0, skipped: 0, failed: 0 };
  for (const member of guild.members.cache.values()) {
    const result = await syncMemberNickname(member);
    results[result] += 1;
  }
  console.log(
    `Nickname sync for guild ${guild.name}: ${results.updated} updated, ${results.skipped} skipped, ${results.failed} failed`,
  );
}

module.exports = { buildNickname, syncMemberNickname, syncNicknamesForGuild };
