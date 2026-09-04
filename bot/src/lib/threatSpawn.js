// The Accept / Decline click on a threat spawn offer (docs/systemdocs/THREATS.md).
//
// The DM arrives in the target's DMs, so guild/member are null; the clicker is
// matched to the offer by Discord user id inside db/lib/threatSpawn.js. The
// acknowledgement is interaction.update(): the buttons come off the message and
// the outcome is written under it, so a dead button can't be clicked twice and
// the DM reads as a record afterwards. Same shape as bot/src/lib/offers.js —
// this file only routes.
const { prisma } = require("@lifeweb/db");
const {
  acceptThreatSpawn,
  declineThreatSpawn,
  applySpawnSideEffects,
} = require("@lifeweb/db/lib/threatSpawn");
const { recordArchiveEvent } = require("@lifeweb/db/lib/archive");
const { syncMemberNickname } = require("./nickname");

// Strips the buttons and writes the outcome under the original text. The
// original content already carries sendDm's `»`; the outcome gets its own.
async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({ content: `${original}\n» ${line}`.slice(0, 2000), components: [] })
    .catch((err) => console.error("Threat spawn button update failed:", err));
}

async function handleThreatSpawnAccept(interaction, spawnId) {
  const result = await acceptThreatSpawn(prisma, spawnId, interaction.user.id);
  if (!result.ok) return void (await settle(interaction, result.reason));

  // Answer first, then do the slow Discord work — the player is watching, and
  // none of what follows may cost a character that already exists.
  await settle(interaction, result.line);

  await applySpawnSideEffects(prisma, result.sideEffects).catch((err) =>
    console.error("Threat spawn side effects failed:", err),
  );

  // The nickname sync wants a guild member, which a DM interaction has not
  // got — fetch it. buildNickname lives on each face separately, so this is
  // the bot's own copy rather than a third one in db/lib.
  try {
    const guild = await interaction.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(interaction.user.id);
    await syncMemberNickname(member);
  } catch (err) {
    console.error("Threat spawn nickname sync failed:", err);
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "character_created",
        targetCharacterId: result.character.id,
        details: { threat: result.threat.name, spawn: true, role: result.character.roleTitle },
      },
    })
    .catch((err) => console.error("Threat spawn audit failed:", err));

  await recordArchiveEvent(prisma, {
    kind: "CHARACTER_CREATED",
    character: result.character,
    zoneId: result.character.zoneId ?? null,
    turn: result.turn,
    content: `${result.character.name} arrived in Ravenheart as ${result.character.roleTitle}.`,
  }).catch((err) => console.error("Threat spawn archive failed:", err));
}

async function handleThreatSpawnDecline(interaction, spawnId) {
  const result = await declineThreatSpawn(prisma, spawnId, interaction.user.id);
  await settle(interaction, result.ok ? result.line : result.reason);
}

module.exports = { handleThreatSpawnAccept, handleThreatSpawnDecline };
