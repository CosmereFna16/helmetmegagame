const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma, concealedAlias } = require("@lifeweb/db");
const { buildZoneSelectRow, buildConfirmRow, performMove, syncCharacterNarrowcastAccess } = require("../lib/zoneTravel");
const { sendDm } = require("../lib/dm");
const { buildMoveModal } = require("../lib/moveModal");
const { confirmMove } = require("../lib/moveConfirm");
const { buildSpeakModal, buildSpeakPicker } = require("../lib/speakModal");
const { listSpeakTargets, canSpeakInTarget, canSpeakInChannel, isNavValue } = require("../lib/speakTargets");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../lib/interactionGuild");
const { postAsCharacterTo } = require("../lib/proxy");
const { resolveLaborRate } = require("@lifeweb/db");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { HEALTH_CATEGORY } = require("@lifeweb/db/lib/medicalVision");
const { moveWindow, epochSeconds } = require("@lifeweb/db/lib/turnClock");
const { rollDie } = require("@lifeweb/db/lib/moveEffects");
const { isPrivateThread, messageLink } = require("../lib/mentions");
const { ensureForumTag, createForumPost, startPrivateThread, addThreadMember } = require("@lifeweb/db/lib/discordRest");
const { PERSISTENT_TAG_NAME } = require("@lifeweb/db/lib/persistence");
const { TOPIC_BUTTON_PREFIX, PRIVATE_BUTTON_PREFIX, WHOS_HERE_PREFIX } = require("@lifeweb/db/lib/zoneAnchorRow");
const {
  buildTopicModal,
  buildPrivateModal,
  TOPIC_MODAL_PREFIX,
  PRIVATE_MODAL_PREFIX,
} = require("../lib/topicModal");
const { resolveChannelContext } = require("../lib/channels");
const { ack, respond, scheduleDismiss } = require("../lib/respond");
const { handleReportOpen, handleReportClose } = require("../lib/reportChannel");
const { BIRD_REPLY_PREFIX, BIRD_REPLY_MODAL_PREFIX } = require("@lifeweb/db/lib/bird");
const { handleBirdReplyOpen, handleBirdReplySubmit } = require("../lib/birdReply");
const {
  OPEN_PREFIX: EDIT_OPEN_PREFIX,
  MODAL_PREFIX: EDIT_MODAL_PREFIX,
  handleEditOpen,
  handleEditSubmit,
} = require("../lib/editModal");
const { OPEN_BUTTON_ID: REPORT_OPEN_ID, CLOSE_BUTTON_ID: REPORT_CLOSE_ID } = require("@lifeweb/db/lib/reportChannelAccess");

// Discord's hard cap on select-menu options, and on max_values with them.
const MENU_OPTION_LIMIT = 25;

async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  await ack(interaction);

  const content = interaction.options.getString("message", true);
  const attachment = interaction.options.getAttachment("attachment");

  try {
    await interaction.channel.send({ content, files: attachment ? [attachment.url] : [] });
  } catch (err) {
    console.error("Failed to send /gm message:", err);
    await respond(interaction, "» *That didn't send. Check the bot can post here, and try again.*");
    return;
  }
  await respond(interaction, "» *Sent.*", { fleeting: true });
}

// /dm: DM a chosen server member as the bot itself, logged via
// bot/src/lib/dm.js#sendDm like every other bot-sent DM.
async function handleGmDmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  await ack(interaction);

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`, { authorDiscordUserId: interaction.user.id, source: "gm_slash" });
    await respond(interaction, `» *Sent to ${recipient}.*`, { fleeting: true });
  } catch (err) {
    console.error("Failed to send /dm DM:", err);
    // 50007 is the real closed-DMs code; an over-length message fails the
    // same way and must not be misreported as closed DMs.
    const closed = err.code === 50007 || err.status === 403;
    await respond(
      interaction,
      closed
        ? "» *Couldn't deliver that — they have DMs closed.*"
        : "» *Couldn't deliver that. It wasn't their DM settings; check the logs.*",
    );
  }
}

// /labor is gone; laboring is a checkbox on the Move modal. This stub only
// exists for the ~1h a removed global command can linger in a client's
// picker. Delete this branch (and its dispatch case) once that window passes.
async function handleLaborStub(interaction) {
  await ack(interaction);
  await respond(interaction, "» *Laboring is now a checkbox on your Move — press the ⚜️ button or use /move.*");
}

// /add and /remove: the private-thread guest list. /add works on any living
// character wherever they stand — recorded as a PlayerThreadInvite, and
// applied immediately if they can already see the zone, else replayed by
// applyPendingInvites on arrival (db/lib/threadInvites.js).
async function handleThreadMemberCommand(interaction, action) {
  const channel = interaction.channel;
  if (!isPrivateThread(channel)) {
    await respond(interaction, "» *That only works inside a private thread.*");
    return;
  }
  await ack(interaction);

  const gm = isGmMember(interaction);
  if (!gm) {
    const member = await channel.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await respond(interaction, "» *You're not in this thread.*");
      return;
    }
  }

  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
  });
  if (!target) {
    await respond(interaction, "» *That isn't a living character's role.*");
    return;
  }

  if (action === "remove") {
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: channel.id, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err));
    try {
      await channel.members.remove(target.discordUserId);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from thread ${channel.id}:`, err);
      await respond(interaction, "» *Couldn't remove them. The bot may be missing Manage Threads.*");
      return;
    }
    await respond(interaction, `» *${target.name} was removed.*`, { fleeting: true });
    return;
  }

  await prisma.playerThreadInvite
    .upsert({
      where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
      update: {},
      create: { threadId: channel.id, characterId: target.id },
    })
    .catch((err) => console.error("Failed to record thread invite:", err));

  const context = resolveChannelContext(channel);
  const here = context.zoneId && target.zoneId === context.zoneId;
  if (here) {
    try {
      await addThreadMember(channel.id, target.discordUserId);
    } catch (err) {
      console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err);
    }
    await respond(interaction, `» *${target.name} was added.*`, { fleeting: true });
    return;
  }
  await respond(
    interaction,
    `» *${target.name} is invited — they'll see this thread when they reach ${context.zoneName ?? "this zone"}.*`,
    { fleeting: true },
  );
}

// /persistent: toggle whether the current thread survives the Dawn wipe.
// The source of truth is PlayerThread.persistent in the DB, never a Discord
// marker — the wipe reads the column, so a stripped forum tag can't fake it.
// Sync-owned posts (Location topics, the Create-a-Topic anchor) refuse.
async function handlePersistentCommand(interaction) {
  const channel = interaction.channel;
  const forumPost = channel?.type === ChannelType.PublicThread && channel.parent?.type === ChannelType.GuildForum;
  const privateThread = isPrivateThread(channel);

  if (!forumPost && !privateThread) {
    await respond(interaction, "» *That only works inside a forum post or a private thread.*");
    return;
  }

  await ack(interaction);

  if (!isGmMember(interaction) && !(await findAliveCharacter(interaction.user.id))) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const [ownedTopic, ownedAnchor] = await Promise.all([
    prisma.locationTopic.findFirst({ where: { discordThreadId: channel.id }, select: { id: true } }),
    prisma.zone.findFirst({ where: { createTopicThreadId: channel.id }, select: { id: true } }),
  ]);
  if (ownedTopic || ownedAnchor) {
    await respond(
      interaction,
      "» *That post belongs to the world — it never gets wiped, and that isn't yours to change.*",
    );
    return;
  }

  const context = resolveChannelContext(channel);
  let row = await prisma.playerThread.findUnique({ where: { threadId: channel.id } });
  if (!row) {
    // A thread with no row was made by a GM by hand — adopt it.
    if (!context.zoneId) {
      await respond(interaction, "» *This thread isn't part of any zone.*");
      return;
    }
    row = await prisma.playerThread.create({
      data: {
        threadId: channel.id,
        kind: forumPost ? "PUBLIC" : "PRIVATE",
        name: channel.name ?? "thread",
        zoneId: context.zoneId,
        persistent: false,
      },
    });
  }

  if (row.keepStarter) {
    await respond(interaction, "» *That's a Quest post — it only goes away when a GM deletes it.*");
    return;
  }

  const persistent = !row.persistent;
  await prisma.playerThread.update({ where: { id: row.id }, data: { persistent } });

  if (forumPost) {
    await mirrorPersistentTag(channel, persistent).catch((err) =>
      console.error(`Failed to mirror the Persistent tag on ${channel.id}:`, err),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "thread_persistence_changed",
        details: {
          threadId: channel.id,
          threadName: channel.name,
          persistent,
          zoneName: context.zoneName ?? null,
        },
      },
    })
    .catch((err) => console.error("Persistence audit log failed:", err));

  await respond(
    interaction,
    persistent
      ? "» *This thread will now survive the nightly wipe — its messages still get cleared. It can still expire after long inactivity.*"
      : "» *This thread is no longer persistent, and will be removed at Dawn.*",
  );
}

async function mirrorPersistentTag(thread, persistent) {
  const tagId = await ensureForumTag(thread.parentId, PERSISTENT_TAG_NAME, null);
  if (!tagId) throw new Error(`No ${PERSISTENT_TAG_NAME} tag available on ${thread.parentId}`);

  const current = thread.appliedTags ?? [];
  const has = current.includes(tagId);
  if (persistent === has) return;
  await thread.setAppliedTags(persistent ? [...current, tagId] : current.filter((id) => id !== tagId));
}

// Custom IDs below are namespaced "zone:" for the travel flow off the Travel
// button on the #turns console (bot/src/lib/turnsConsole.js, whose button
// keeps its historical "loc:open" id); "move:" and "say:" are the unrelated
// Move and Speak modals.
async function handleOpen(interaction) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  // An unset zone can pick any presence zone freely; otherwise the picker
  // offers only the current zone's direct neighbors. Caves is never a target.
  let zones;
  let currentZone = null;
  if (!character.zoneId) {
    zones = await prisma.zone.findMany({
      where: { kind: { not: "CAVE_GROUP" } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  } else {
    currentZone = await prisma.zone.findUnique({
      where: { id: character.zoneId },
      include: { connectsTo: true },
    });
    zones = [...(currentZone?.connectsTo ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (zones.length === 0) {
    await respond(interaction, "» *Nowhere to go from here.*");
    return;
  }

  await respond(interaction, {
    content: "Where would you like to move? Choose a zone.",
    components: [buildZoneSelectRow(zones, currentZone)],
  });
}

async function handlePlaceSelect(interaction) {
  await ack(interaction, { update: true });

  const zoneId = interaction.values[0];
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    await respond(interaction, { content: "» *That zone no longer exists.*", components: [] });
    return;
  }

  await respond(interaction, {
    content: `Move to **${zone.name}**?`,
    components: [buildConfirmRow(zoneId)],
  });
}

async function handleConfirm(interaction, zoneId) {
  await interaction.deferUpdate();

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, { content: "» *You don't have a living character.*", components: [] });
    return;
  }

  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    await respond(interaction, { content: "» *That zone no longer exists.*", components: [] });
    return;
  }

  const { guild } = await resolveActingMember(interaction);
  if (!guild) {
    await respond(interaction, { content: "» *Couldn't reach the server.*", components: [] });
    return;
  }

  const hadZone = Boolean(character.zoneId);
  const result = await performMove(guild, character, zone);
  if (!result.ok) {
    await respond(interaction, { content: `» *${result.reason}*`, components: [] });
    return;
  }

  const suffix = hadZone ? " Your turn is spent." : "";
  await respond(interaction, { content: `» Moved to **${zone.name}**.${suffix}`, components: [] });
}

async function handleCancel(interaction) {
  await interaction.update({ content: "» *Canceled.*", components: [] });
  scheduleDismiss(interaction);
}

// Create a Topic / Create a Private Thread: the two anchor buttons of
// db/lib/zoneAnchorRow.js. Players hold no create-posts/create-threads
// permission — the bot makes every thread, so PlayerThread stays complete.

async function handleTopicOpen(interaction, zoneId) {
  await interaction.showModal(buildTopicModal(zoneId));
}

async function handlePrivateOpen(interaction, zoneId) {
  await interaction.showModal(buildPrivateModal(zoneId));
}

// The green "Who's here?" button. Replies privately with the ALIVE names in
// the zone plus same-faction Role, mirroring the 🔍 inspect gate: Role is
// same-faction knowledge, not Silo authority (FACTIONS.md §4a).
async function handleWhosHere(interaction, zoneId) {
  await ack(interaction);

  const [viewer, present] = await Promise.all([
    prisma.character.findFirst({
      where: { discordUserId: interaction.user.id, status: "ALIVE" },
      select: { factionId: true },
    }),
    prisma.character.findMany({
      where: { status: "ALIVE", zoneId },
      select: { name: true, roleTitle: true, factionId: true, faction: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    }),
  ]);

  if (present.length === 0) {
    await respond(interaction, "» *Nobody is here.*");
    return;
  }

  const names = present.map((c) => {
    const sameFaction =
      viewer?.factionId &&
      c.factionId === viewer.factionId &&
      c.faction?.name !== "Unaffiliated" &&
      c.roleTitle;
    return sameFaction ? `${c.name}, ${c.roleTitle}` : c.name;
  });
  await respond(interaction, names.join(" | "));
}

async function resolveCreationContext(interaction, zoneId) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return null;
  }
  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    await respond(interaction, "» *That zone no longer exists.*");
    return null;
  }
  if (character.zoneId !== zone.id) {
    await respond(interaction, `» *You're not in ${zone.name} any more.*`);
    return null;
  }
  const name = interaction.fields.getTextInputValue("topic:name").trim().slice(0, 90);
  if (!name) {
    await respond(interaction, "» *Give it a name.*");
    return null;
  }
  const persistent = optionalCheckbox(interaction, "topic:persistent");
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  return { character, zone, name, persistent, openTurn };
}

async function recordPlayerThread({ threadId, kind, name, zone, character, persistent, openTurn }) {
  await prisma.playerThread.create({
    data: {
      threadId,
      kind,
      name,
      zoneId: zone.id,
      creatorCharacterId: character.id,
      creatorDiscordUserId: character.discordUserId,
      persistent,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId,
        actionType: kind === "PUBLIC" ? "player_topic_created" : "player_thread_created",
        targetCharacterId: character.id,
        details: { threadId, name, zoneName: zone.name, persistent },
      },
    })
    .catch((err) => console.error("Thread-creation audit log failed:", err));
}

async function handleTopicCreate(interaction, zoneId) {
  await ack(interaction);

  const resolved = await resolveCreationContext(interaction, zoneId);
  if (!resolved) return;
  const { character, zone, name, persistent, openTurn } = resolved;

  if (!zone.discordPublicChannelId) {
    await respond(interaction, "» *This zone has no public forum.*");
    return;
  }

  const appliedTags = [];
  if (persistent) {
    const tagId = await ensureForumTag(zone.discordPublicChannelId, PERSISTENT_TAG_NAME, null).catch(() => null);
    if (tagId) appliedTags.push(tagId);
  }

  let thread;
  try {
    // Opener names the CHARACTER's role (a token nobody holds), not the
    // player, so the button-presser isn't outed as the author.
    const opener = character.discordRoleId ? `<@&${character.discordRoleId}>` : character.name;
    thread = await createForumPost(zone.discordPublicChannelId, {
      name,
      content: `${opener} opened this scene.`,
      appliedTags,
      allowedMentions: { parse: [], roles: character.discordRoleId ? [character.discordRoleId] : [] },
    });
  } catch (err) {
    console.error(`Failed to create a topic in ${zone.name}:`, err);
    await respond(interaction, "» *Couldn't create that — try again, or tell a GM.*");
    return;
  }

  await recordPlayerThread({ threadId: thread.id, kind: "PUBLIC", name, zone, character, persistent, openTurn });
  await respond(interaction, `» *Opened.*\n${messageLink(interaction.guildId, zone.discordPublicChannelId, thread.id)}`, {
    fleeting: false,
  });
}

async function handlePrivateCreate(interaction, zoneId) {
  await ack(interaction);

  const resolved = await resolveCreationContext(interaction, zoneId);
  if (!resolved) return;
  const { character, zone, name, persistent, openTurn } = resolved;

  if (!zone.discordPrivateChannelId) {
    await respond(interaction, "» *This zone has no private channel.*");
    return;
  }

  let thread;
  try {
    thread = await startPrivateThread(zone.discordPrivateChannelId, name);
    await addThreadMember(thread.id, interaction.user.id);
  } catch (err) {
    console.error(`Failed to create a private thread in ${zone.name}:`, err);
    await respond(interaction, "» *Couldn't create that — try again, or tell a GM.*");
    return;
  }

  await recordPlayerThread({ threadId: thread.id, kind: "PRIVATE", name, zone, character, persistent, openTurn });
  await respond(interaction, `» *Opened.*\n${messageLink(interaction.guildId, thread.id, thread.id)}`, {
    fleeting: true,
  });
}

// Moves close MOVE_LOCK_HOURS before the turn ends (db/lib/turnClock.js).
// Returns the refusal text, or null when Moves are still open.
async function moveLockNotice() {
  const [openTurn, config] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { autoTurnAdvanceDisabled: true } }),
  ]);
  if (!openTurn) return null;
  const { locked, cutoffAt, endsAt } = moveWindow(openTurn, {
    autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
  });
  if (!locked) return null;
  return `» *Moves for this turn locked at <t:${epochSeconds(cutoffAt)}:t>. The next turn opens <t:${epochSeconds(endsAt)}:R>.*`;
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// this is the only read before it — with an 800ms race so a slow pool
// doesn't cost the player the modal. Submit re-checks the cutoff.
async function handleMoveOpen(interaction) {
  const notice = await Promise.race([
    moveLockNotice().catch((err) => {
      console.error("Move lock check failed:", err);
      return null;
    }),
    new Promise((resolve) => setTimeout(() => resolve(null), 800)),
  ]);
  if (notice) {
    await respond(interaction, notice);
    return;
  }
  await interaction.showModal(buildMoveModal());
}

async function handleMoveSubmit(interaction) {
  // FIRST: this handler does easily enough DB work to pass three seconds
  // under load, and a late ack would make a committed Move look unsent.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) {
    await respond(interaction, "» *No turn is currently open — your submission wasn't recorded.*");
    return;
  }

  // Re-checked here, not only at move:open — a modal can sit open across
  // the cutoff. Before the Action row so a refusal costs no turn.
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { autoTurnAdvanceDisabled: true },
  });
  const { locked, cutoffAt, endsAt } = moveWindow(openTurn, {
    autoTurnAdvanceDisabled: config?.autoTurnAdvanceDisabled ?? false,
  });
  if (locked) {
    await respond(
      interaction,
      `» *Moves for this turn locked at <t:${epochSeconds(cutoffAt)}:t>. The next turn opens <t:${epochSeconds(endsAt)}:R>.*`,
    );
    return;
  }

  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (alreadyActed) {
    await respond(interaction, "» *You've already locked in a Move this turn — your submission wasn't recorded.*");
    return;
  }

  const raw = interaction.fields.getTextInputValue("move:body").trim();
  if (!raw) {
    await respond(interaction, "» *Write something first.*");
    return;
  }

  const moveKind = interaction.fields.getRadioGroup("move:kind");
  const labor = optionalCheckbox(interaction, "move:labor");
  const description = raw;

  if (labor && moveKind === "GAMBIT") {
    await respond(
      interaction,
      "» *If you choose to Labor on a turn, you can only do that — Laboring has to be Routine work.*",
    );
    return;
  }

  let resourceRollExpression = null;
  let laborTier = null;
  let laborBonus = 0;
  if (labor) {
    const rate = await resolveLaborRate(prisma, character.id);
    if (!rate.ok) {
      await respond(interaction, `» *${rate.reason}*`);
      return;
    }
    resourceRollExpression = rate.expression;
    laborTier = rate.tier;
    laborBonus = rate.bonus ?? 0;
  }

  // @@unique([characterId, turnId]) is the real gate; a retried interaction
  // at rollover must not become a second Move.
  let action;
  try {
    action = await prisma.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "PENDING_TYPE",
        moveKind,
        description,
        resourceDelta: null,
        resourceRollExpression,
        zoneId: character.zoneId ?? null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") {
      await respond(interaction, "» *You've already acted this turn.*");
      return;
    }
    throw err;
  }

  await touchCharacterActivity(prisma, character.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id, labor, tier: laborTier },
    },
  });

  const loaded = await prisma.action.findUnique({
    where: { id: action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });

  const { lines } = await confirmMove(loaded, interaction.user.id, { laborBonus });
  await respond(interaction, lines.join("\n"));
}

// setRequired(false) fields may be absent from the submitted payload, and
// fields.getX() throws on a component it can't find.
function optionalText(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId) ?? "";
  } catch {
    return "";
  }
}

function optionalCheckbox(interaction, customId) {
  try {
    return Boolean(interaction.fields.getCheckbox(customId));
  } catch {
    return false;
  }
}

async function handleSpeakOpen(interaction) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  if (!guild || !member) {
    await respond(interaction, "» *Couldn't reach the server.*");
    return;
  }

  const { options, truncated } = await listSpeakTargets(guild, member);
  if (options.length === 0) {
    await respond(interaction, "» *There's nowhere you can speak right now.*");
    return;
  }

  const { rows, note } = buildSpeakPicker(options, truncated);
  await respond(interaction, {
    content: ["Where would you like to speak?", note].filter(Boolean).join("\n"),
    components: rows,
  });
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// nothing is awaited here — the permission re-check lives on submit.
async function handleSpeakPick(interaction) {
  const targetId = interaction.values[0];
  if (isNavValue(targetId)) {
    await interaction.deferUpdate();
    return;
  }

  const cached = interaction.client.channels.cache.get(targetId);
  await interaction.showModal(buildSpeakModal(targetId, cached ? `#${cached.name}` : null));
}

async function handleSpeakSubmit(interaction, channelId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  // client.channels, not guild.channels: the destination may be a thread.
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!guild || !channel || !member || !canSpeakInTarget(channel, member)) {
    await respond(interaction, "» *You can't speak there any more.*");
    return;
  }

  const body = optionalText(interaction, "say:body").trim();
  if (!body) {
    await respond(interaction, "» *Write something.*");
    return;
  }

  const conceal = optionalCheckbox(interaction, "say:conceal")
    ? { alias: concealedAlias(character) }
    : null;

  let posted;
  try {
    posted = await postAsCharacterTo(channel, character, {
      content: body,
      discordUserId: interaction.user.id,
      conceal,
    });
  } catch (err) {
    console.error("Failed to post a Speak message:", err);
    await respond(interaction, "» *Couldn't post that.*");
    return;
  }

  await recordArchiveMessage(prisma, {
    discordMessageId: posted.webhookMessage.id,
    content: posted.content,
    character,
    concealedAlias: conceal?.alias ?? null,
    ...resolveChannelContext(channel),
  });
  await touchCharacterActivity(prisma, character.id);

  await respond(interaction, `» *Sent.*\n${messageLink(guild.id, channel.id, posted.webhookMessage.id)}`);
}

// /message: inside a channel the player can already speak in, skip the
// picker and post there directly.
async function handleMessageCommand(interaction) {
  const channel = interaction.channel;
  if (interaction.inGuild() && interaction.member && channel && canSpeakInTarget(channel, interaction.member)) {
    await interaction.showModal(buildSpeakModal(channel.id, `#${channel.name}`));
    return;
  }
  await handleSpeakOpen(interaction);
}

// GM-only, and deliberately not the player medic path
// (web/app/(app)/character/requestActions.js#healCharacterRequest), which
// charges a payer and requires co-location. Category is the only filter.
async function handleHealCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  await ack(interaction);

  const role = interaction.options.getRole("character", true);
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, "» *That isn't a living character's role.*");
    return;
  }

  const afflictions = target.tags.filter((ct) => ct.tag.category === HEALTH_CATEGORY);
  if (afflictions.length === 0) {
    await respond(interaction, `» *${target.name} has nothing to treat.*`);
    return;
  }

  // Discord caps a select menu at 25 options, and max_values must track the
  // slice or the whole component is rejected.
  const shown = afflictions.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`heal:pick:${target.id}`)
    .setPlaceholder("What to clear…")
    .setMinValues(1)
    .setMaxValues(shown.length)
    .addOptions(shown.map((ct) => ({ label: ct.tag.name, value: ct.tagId })));

  const truncated = afflictions.length > shown.length;
  await respond(interaction, {
    content:
      `Clear what from **${target.name}**?` +
      (truncated ? `\n-# Showing the first ${shown.length} of ${afflictions.length}.` : ""),
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleHealPick(interaction, characterId) {
  if (!isGmMember(interaction)) {
    await interaction.update({ content: "» *GMs only.*", components: [] });
    scheduleDismiss(interaction);
    return;
  }
  await interaction.deferUpdate();

  const tagIds = interaction.values;
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, { content: "» *That character no longer exists.*", components: [] });
    return;
  }

  const cleared = target.tags.filter((ct) => tagIds.includes(ct.tagId)).map((ct) => ct.tag.name);

  await prisma.$transaction(async (tx) => {
    for (const tagId of tagIds) {
      await dropCharacterTag(tx, characterId, tagId);
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "gm_heal",
      targetCharacterId: characterId,
      details: { tagIds, tagNames: cleared },
    },
  });

  const { guild } = await resolveActingMember(interaction);
  if (guild) await syncCharacterNarrowcastAccess(guild, target).catch(() => {});

  await respond(interaction, {
    content: `» *Cleared ${cleared.join(", ")} from ${target.name}.*`,
    components: [],
  });
}

// The one die a player rolls for themselves; posted as a plain bot message
// rather than a public interaction reply, which would carry Discord's
// "@account used /roll" header and out the player behind the character
// (PROXYING.md).
async function handleRollCommand(interaction) {
  await ack(interaction);
  const value = rollDie(6);
  const posted = await interaction.channel?.send(`» *A die is cast* — **${value}**`).catch(() => null);
  await respond(interaction, posted ? `» *You rolled a ${value}.*` : "» *Could not post a roll here.*");
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "dm") return void (await handleGmDmCommand(interaction));
        if (interaction.commandName === "heal") return void (await handleHealCommand(interaction));
        if (interaction.commandName === "add" || interaction.commandName === "remove") {
          return void (await handleThreadMemberCommand(interaction, interaction.commandName));
        }
        if (interaction.commandName === "persistent") {
          return void (await handlePersistentCommand(interaction));
        }
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location") return void (await handleOpen(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "roll") return void (await handleRollCommand(interaction));
        if (interaction.commandName === "labor") return void (await handleLaborStub(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleOpen(interaction));
        if (interaction.customId === "zone:cancel") return void (await handleCancel(interaction));
        if (interaction.customId.startsWith("zone:confirm:")) {
          return void (await handleConfirm(interaction, interaction.customId.slice("zone:confirm:".length)));
        }
        if (interaction.customId.startsWith(TOPIC_BUTTON_PREFIX)) {
          return void (await handleTopicOpen(interaction, interaction.customId.slice(TOPIC_BUTTON_PREFIX.length)));
        }
        if (interaction.customId.startsWith(PRIVATE_BUTTON_PREFIX)) {
          return void (await handlePrivateOpen(interaction, interaction.customId.slice(PRIVATE_BUTTON_PREFIX.length)));
        }
        if (interaction.customId.startsWith(WHOS_HERE_PREFIX)) {
          return void (await handleWhosHere(interaction, interaction.customId.slice(WHOS_HERE_PREFIX.length)));
        }
        if (interaction.customId === "move:open") return void (await handleMoveOpen(interaction));
        if (interaction.customId === "say:open") return void (await handleSpeakOpen(interaction));
        // Arrives in a DM on a Bird's letter, so guild/member are null.
        if (interaction.customId.startsWith(BIRD_REPLY_PREFIX)) {
          return void (await handleBirdReplyOpen(interaction, interaction.customId.slice(BIRD_REPLY_PREFIX.length)));
        }
        if (interaction.customId === REPORT_OPEN_ID) return void (await handleReportOpen(interaction));
        if (interaction.customId === REPORT_CLOSE_ID) return void (await handleReportClose(interaction));
        // Arrives in a DM; must NOT be acked first since it opens a modal.
        if (interaction.customId.startsWith(EDIT_OPEN_PREFIX)) return void (await handleEditOpen(interaction));
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "zone:place") return void (await handlePlaceSelect(interaction));
        if (interaction.customId === "say:pick") return void (await handleSpeakPick(interaction));
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (interaction.customId.startsWith(TOPIC_MODAL_PREFIX)) {
          return void (await handleTopicCreate(interaction, interaction.customId.slice(TOPIC_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(PRIVATE_MODAL_PREFIX)) {
          return void (await handlePrivateCreate(interaction, interaction.customId.slice(PRIVATE_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith("say:send:")) {
          return void (await handleSpeakSubmit(interaction, interaction.customId.slice("say:send:".length)));
        }
        if (interaction.customId.startsWith(BIRD_REPLY_MODAL_PREFIX)) {
          return void (await handleBirdReplySubmit(interaction, interaction.customId.slice(BIRD_REPLY_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) return void (await handleEditSubmit(interaction));
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
      await respondToFailure(interaction);
    }
  },
};

async function respondToFailure(interaction) {
  if (!interaction.isRepliable?.()) return;
  await respond(interaction, { content: "» *Something went wrong — that didn't go through.*", components: [] });
}
