const { prisma, formatBareName } = require("@lifeweb/db");

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
  // Checked before any DB work: `manageable` is false for the guild owner and
  // for anyone whose highest role sits at or above the bot's — precisely the
  // members setNickname can only ever answer 403 for. That 403 used to be
  // logged, counted as "failed", and then retried on every single restart
  // forever, which is both pointless and a standing contribution to the
  // Cloudflare invalid-response counter (see the breaker in
  // db/lib/discordRest.js). discord.js computes this from the cached role
  // hierarchy, so declining here costs zero API calls.
  if (member.user.bot) return "skipped";
  if (!member.manageable) return "skipped";

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return "skipped";

  const character = await prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE", firstName: { not: "" } },
  });
  if (!character) return "skipped";

  const base = member.user.displayName;
  // Bare (first + last), not the displayed name. The 32-char cap is shared
  // between the two halves — about 14 each — and `Sir Jorren "the Blind"
  // Vask` is 27 on its own, so titling here would truncate every nickname in
  // the guild to garbage. This is the one place a title deliberately does
  // not show. web/lib/discordGuild.js#syncCharacterNickname does the same.
  const nickname = buildNickname(base, formatBareName(character));
  if (member.nickname === nickname) return "skipped";

  try {
    await member.setNickname(nickname);
    return "updated";
  } catch (err) {
    console.error(`Failed to set nickname for ${member.user.tag} (${member.id}): ${err.message}`);
    return "failed";
  }
}

// One-time bulk catch-up (called on bot connect) for whatever drifted while
// the bot was offline — not a recurring poll.
async function syncNicknamesForGuild(guild) {
  // Gate once for the whole guild rather than once per member: the per-member
  // path re-reads GameConfig every call, which is a query per guild member
  // (not per character — spectators and lurkers included) on every startup.
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) {
    console.log(`Nickname sync for guild ${guild.name}: disabled, skipped.`);
    return;
  }

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
