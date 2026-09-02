// The OOC report channel — one anchor post with an Open Ticket button, and a
// private thread per report. Hardcoded id rather than an env var, for the
// roleIds.js reason: one guild, one correct value, not a secret. Access is
// re-asserted on every bot ready (bot/src/lib/reportChannel.js): @everyone
// can't see it, Player can, GMs can also manage threads. Nobody is denied
// SEND_MESSAGES on the channel itself — the bot deletes whatever lands
// there, GMs included, so it stays one post tall without a lock. The two
// custom ids are routed by exact equality in
// bot/src/events/interactionCreate.js — change one here and there together.
const { putChannelOverwrite } = require("./discordRest");
const { PLAYER_ROLE_ID } = require("./roleIds");

const REPORT_CHANNEL_ID = "1543298375250616340";

const OPEN_BUTTON_ID = "report:open";
const CLOSE_BUTTON_ID = "report:close";

const BUTTON = 2;
const ACTION_ROW = 1;
const SUCCESS = 3;
const DANGER = 4;

const REPORT_ANCHOR_TEXT = "Report an OOC problem.";

const REPORT_OPEN_ROW = {
  type: ACTION_ROW,
  components: [{ type: BUTTON, style: SUCCESS, custom_id: OPEN_BUTTON_ID, label: "Open Ticket" }],
};

const REPORT_CLOSE_ROW = {
  type: ACTION_ROW,
  components: [{ type: BUTTON, style: DANGER, custom_id: CLOSE_BUTTON_ID, label: "Close" }],
};

const PERM_VIEW_CHANNEL = 1024n;
const PERM_ADD_REACTIONS = 64n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_MANAGE_THREADS = 17179869184n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

const PLAYER_ALLOW = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES_IN_THREADS | PERM_ATTACH_FILES | PERM_ADD_REACTIONS;
const GM_ALLOW = PLAYER_ALLOW | PERM_MANAGE_THREADS | PERM_MANAGE_MESSAGES;

// Idempotent single-target PUTs, so nothing else set by hand on the channel
// is disturbed — same reasoning as spectatorAccess.js.
async function syncReportChannelAccess() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) return { ok: false, reason: "unconfigured" };

  await putChannelOverwrite(REPORT_CHANNEL_ID, guildId, { deny: PERM_VIEW_CHANNEL.toString() });
  await putChannelOverwrite(REPORT_CHANNEL_ID, PLAYER_ROLE_ID, { allow: PLAYER_ALLOW.toString() });
  if (gmRoleId) await putChannelOverwrite(REPORT_CHANNEL_ID, gmRoleId, { allow: GM_ALLOW.toString() });
  return { ok: true };
}

module.exports = {
  REPORT_CHANNEL_ID,
  OPEN_BUTTON_ID,
  CLOSE_BUTTON_ID,
  REPORT_ANCHOR_TEXT,
  REPORT_OPEN_ROW,
  REPORT_CLOSE_ROW,
  syncReportChannelAccess,
};
