const { ChannelType, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma, LABOR_FIELDS, FIELD_INFO, concealedAlias } = require("@lifeweb/db");
const { buildLocationSelectRow, buildConfirmRow, performMove, syncCharacterNarrowcastAccess } = require("../lib/location");
const { performLabor } = require("../lib/labor");
const { sendDm } = require("../lib/dm");
const { buildMoveModal } = require("../lib/moveModal");
const { confirmMove } = require("../lib/moveConfirm");
const { buildSpeakModal, buildSpeakPicker } = require("../lib/speakModal");
const { listSpeakTargets, canSpeakIn, NAV_VALUE } = require("../lib/speakTargets");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../lib/interactionGuild");
const { postAsCharacterTo } = require("../lib/proxy");
const { parseResourceExpression } = require("../lib/resourceDelta");
const { resolveLaborRate } = require("@lifeweb/db");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { HEALTH_CATEGORY } = require("@lifeweb/db/lib/medicalVision");
const { canJoinThread, isPrivateThread, messageLink } = require("../lib/mentions");
const { ensureForumTag } = require("@lifeweb/db/lib/discordRest");
const {
  PERSISTENT_TAG_NAME,
  PERSISTENT_EMOJI,
  isPersistentThreadName,
  withPersistentPrefix,
  withoutPersistentPrefix,
} = require("@lifeweb/db/lib/persistence");
const { resolveChannelContext } = require("../lib/channels");

// /gm: post to the current channel as the bot itself, not the invoker's
// character — the slash-command replacement for the old ":gm" message
// prefix (deleted the invoker's message and reposted it; a slash command
// has no message of its own to delete, so it just sends directly).
async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const content = interaction.options.getString("message", true);
  const attachment = interaction.options.getAttachment("attachment");

  await interaction.channel.send({ content, files: attachment ? [attachment.url] : [] });
  await interaction.reply({ content: "» *Sent.*", flags: MessageFlags.Ephemeral });
}

// /dm: DM a chosen server member as the bot itself. Was /message, renamed
// when /message became the player-facing "speak as your character" command.
// Reuses bot/src/lib/dm.js#sendDm so it's logged to DirectMessage like every
// other bot-sent DM, and carries the "»" prefix inline since this is a
// bot-composed DM (see the "Bot message style" note in CLAUDE.md).
async function handleGmDmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`);
    await interaction.reply({ content: `» *Sent to ${recipient}.*`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error("Failed to send /dm DM:", err);
    await interaction.reply({ content: "» *Failed to deliver — they may have DMs closed.*", flags: MessageFlags.Ephemeral });
  }
}

// /labor <type>: any player with a living, un-acted character can use it —
// no GM gate. `type` is the LABOR_FIELDS key. See
// bot/src/lib/labor.js#performLabor for the tag-tier lookup, the location
// gate and the auto-resolved Action creation.
async function handleLaborCommand(interaction, field) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const result = await performLabor(character, field);
  if (!result.ok) {
    await interaction.reply({ content: `» *${result.reason}*`, flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = [`» ${character.name} ${FIELD_INFO[field].verb}.`];
  // A flat tier (min === max) has nothing to show its work for.
  lines.push(
    result.min === result.max
      ? `**Resource change:** +${result.resourceDelta} ⬢`
      : `**Resource roll (${result.min}–${result.max}):** +${result.resourceDelta} ⬢`,
  );
  lines.push("» *Move confirmed — waiting on GM review.*");

  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}

// /add and /remove: the private-thread guest list. Both take a ROLE option so
// the picker names characters rather than Discord accounts (see
// bot/src/lib/commands.js), and both refuse outside a private thread.
//
// Anyone already in the thread may add or remove, plus GMs — the same posture
// as pinging someone in, which any participant can already do. Nothing here
// needs persisting: an ordinary private thread is deleted wholesale at Dawn
// (db/lib/dawnWipe.js) and takes its guest list with it, while one marked by
// /persistent survives and keeps that list on Discord's side — which is most
// of why marking one is worth doing.
async function handleThreadMemberCommand(interaction, action) {
  const channel = interaction.channel;
  if (!isPrivateThread(channel)) {
    await interaction.reply({
      content: "» *That only works inside a private thread.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const gm = isGmMember(interaction);
  if (!gm) {
    const member = await channel.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: "» *You're not in this thread.*",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
  });
  if (!target) {
    await interaction.reply({
      content: "» *That isn't a living character's role.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "remove") {
    // Caught rather than left to the outer handler, which only logs — the
    // likely failure is the bot lacking MANAGE_THREADS on this channel, and
    // the invoker would otherwise just see "the application did not respond".
    try {
      await channel.members.remove(target.discordUserId);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from thread ${channel.id}:`, err);
      await interaction.reply({
        content: "» *Couldn't remove them — the bot may be missing Manage Threads here.*",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({ content: `» *${target.name} was removed.*`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Location-scoped rather than Zone-scoped, and not a choice: Discord needs
  // the target to be able to view the thread's parent channel, which only
  // holds while they're standing in that Location.
  const context = resolveChannelContext(channel);
  if (!canJoinThread(target, context)) {
    await interaction.reply({
      content: `» *${target.name} isn't in ${context.locationName ?? "this location"} — they can't be brought in.*`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await channel.members.add(target.discordUserId);
  } catch (err) {
    console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err);
    await interaction.reply({
      content: "» *Couldn't add them — they may not be able to see this location.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({ content: `» *${target.name} was added.*`, flags: MessageFlags.Ephemeral });
}

// /persistent: toggle whether the current thread survives the Dawn wipe.
//
// Two markers because the two channel types can't share one — a forum post
// carries the real ⏰ forum tag, a private thread carries a ⏰ name prefix,
// since a text channel can't have forum tags at all. db/lib/persistence.js
// owns both, and db/lib/dawnWipe.js reads both.
//
// Gate is a living character or GM, deliberately NOT the thread-membership
// check /add uses: that's wrong for a forum post, where you can act on a post
// without having joined it, and redundant in a private thread, where being
// able to run the command already proves access.
async function handlePersistentCommand(interaction) {
  const channel = interaction.channel;
  const forumPost = channel?.type === ChannelType.PublicThread && channel.parent?.type === ChannelType.GuildForum;
  const privateThread = isPrivateThread(channel);

  if (!forumPost && !privateThread) {
    await interaction.reply({
      content: "» *That only works inside a forum post or a private thread.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isGmMember(interaction) && !(await findAliveCharacter(interaction.user.id))) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  let persistent;
  try {
    persistent = forumPost ? await toggleForumPostTag(channel) : await togglePrivateThreadPrefix(channel);
  } catch (err) {
    console.error(`Failed to toggle persistence on thread ${channel.id}:`, err);
    await interaction.reply({
      content: "» *Couldn't change that — the bot may be missing Manage Threads here.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const context = resolveChannelContext(channel);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "thread_persistence_changed",
        details: {
          threadId: channel.id,
          threadName: channel.name,
          persistent,
          locationName: context.locationName ?? null,
        },
      },
    })
    .catch((err) => console.error("Persistence audit log failed:", err));

  await interaction.reply({
    content: persistent
      ? "» *This thread will now survive the Dawn wipe — its messages still get cleared.*"
      : "» *This thread is no longer persistent, and will be removed at Dawn.*",
    flags: MessageFlags.Ephemeral,
  });
}

// ensureForumTag rather than getForumTagId: a forum channel provisioned before
// the Persistent tag existed would otherwise fail silently here, and this
// creates it idempotently instead. Returns the thread's new persistence state.
async function toggleForumPostTag(thread) {
  const tagId = await ensureForumTag(thread.parentId, PERSISTENT_TAG_NAME, PERSISTENT_EMOJI);
  if (!tagId) throw new Error(`No ${PERSISTENT_TAG_NAME} tag available on ${thread.parentId}`);

  const current = thread.appliedTags ?? [];
  const has = current.includes(tagId);
  await thread.setAppliedTags(has ? current.filter((id) => id !== tagId) : [...current, tagId]);
  return !has;
}

async function togglePrivateThreadPrefix(thread) {
  const persistent = !isPersistentThreadName(thread.name);
  await thread.setName(
    persistent ? withPersistentPrefix(thread.name) : withoutPersistentPrefix(thread.name),
  );
  return persistent;
}

// All custom IDs below are namespaced "loc:" for the travel flow triggered
// from the Travel button on the #turns console
// (bot/src/lib/turnsConsole.js) — "move:" and "say:" IDs further down are
// the unrelated Move and Speak modals.
async function handleOpen(interaction) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  // An unset Location (brand-new character) can freely pick any Location to
  // start in; otherwise the picker only offers the current Location's
  // direct neighbors (see Location.connectsTo / performMove) — moving is
  // now location-by-location, not "anywhere in zone, or any connected
  // zone."
  let locations;
  let currentLocation = null;
  if (!character.locationId) {
    locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  } else {
    currentLocation = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { connectsTo: true },
    });
    locations = [...(currentLocation?.connectsTo ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (locations.length === 0) {
    await interaction.reply({ content: "» *Nowhere to go from here.*", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Where would you like to move? Choose a location.",
    components: [buildLocationSelectRow(locations, currentLocation)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePlaceSelect(interaction) {
  const locationId = interaction.values[0];
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await interaction.update({ content: "» *That location no longer exists.*", components: [] });
    return;
  }

  await interaction.update({
    content: `Move to **${location.name}**?`,
    components: [buildConfirmRow(locationId)],
  });
}

async function handleConfirm(interaction, locationId) {
  await interaction.deferUpdate();

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.editReply({ content: "» *You don't have a living character.*", components: [] });
    return;
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await interaction.editReply({ content: "» *That location no longer exists.*", components: [] });
    return;
  }

  const { guild } = await resolveActingMember(interaction);
  if (!guild) {
    await interaction.editReply({ content: "» *Couldn't reach the server.*", components: [] });
    return;
  }

  const result = await performMove(guild, character, location);
  if (!result.ok) {
    await interaction.editReply({ content: `» *${result.reason}*`, components: [] });
    return;
  }

  const suffix = result.free ? "" : " Your turn is spent.";
  await interaction.editReply({ content: `» Moved to **${location.name}**.${suffix}`, components: [] });
}

async function handleCancel(interaction) {
  await interaction.update({ content: "» *Cancelled.*", components: [] });
}

// --- Move ------------------------------------------------------------
//
// One modal, submitted once. The old flow (a message in #turns became a
// PENDING_TYPE Action, the bot deleted it and DMed two select menus plus a
// Confirm button) is gone: it leaked identity twice and cost four round trips.
// PENDING_TYPE is no longer reachable from Discord — the enum value stays for
// rows written before this.

// The button and /move both just open the modal. Nothing is read here: a
// modal must be shown within 3 seconds and cannot be deferred first, so every
// gate runs on submit instead.
async function handleMoveOpen(interaction) {
  await interaction.showModal(buildMoveModal());
}

// The gates the old handleActionSubmission ran, in the same order and with
// the same refusal strings — but replying ephemerally rather than deleting a
// message and DMing.
async function handleMoveSubmit(interaction) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) {
    await interaction.reply({
      content: "» *No turn is currently open — your submission wasn't recorded.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Also catches a prior auto-resolved zone-change Move (see
  // bot/src/lib/location.js#performMove) — changing zones spends the turn
  // just like a Move submission does.
  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (alreadyActed) {
    await interaction.reply({
      content: "» *You've already sent a Move this turn — your submission wasn't recorded.*",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const raw = interaction.fields.getTextInputValue("move:body").trim();
  if (!raw) {
    await interaction.reply({ content: "» *Write something first.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const moveKind = interaction.fields.getRadioGroup("move:kind");
  const opposed = Boolean(interaction.fields.getCheckbox("move:opposed"));

  const { description, resourceDelta, roll } = parseResourceExpression(raw);

  // A "/hunt"-style shorthand is collapsed into a concrete range here rather
  // than at confirm, for two reasons: the turn is spent by the Action row
  // existing, so the location gate has to run before we create one (a refusal
  // must cost nothing); and resolving now means only one grammar — a plain
  // range — ever reaches the database.
  let resourceRollExpression = roll?.expression ?? null;
  if (roll?.kind === "shorthand") {
    const rate = await resolveLaborRate(prisma, character.id, roll.field);
    if (!rate.ok) {
      await interaction.reply({ content: `» *${rate.reason}*`, flags: MessageFlags.Ephemeral });
      return;
    }
    resourceRollExpression = rate.expression;
  }

  const action = await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type: "MOVE",
      status: "PENDING_TYPE",
      moveKind,
      opposed,
      description,
      resourceDelta,
      resourceRollExpression,
      zoneId: character.zoneId ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id },
    },
  });

  // Re-read with the tags confirmMove needs for the Gambit modifier.
  const loaded = await prisma.action.findUnique({
    where: { id: action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });

  const { lines } = await confirmMove(loaded, interaction.user.id);
  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}

// --- Speak -----------------------------------------------------------

// The Speak button, and /message run anywhere the player cannot already
// speak. Deferred, because enumerating threads costs API calls — which is
// exactly why the modal cannot be opened straight from this button.
async function handleSpeakOpen(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.editReply({ content: "» *You don't have a living character.*" });
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  if (!guild || !member) {
    await interaction.editReply({ content: "» *Couldn't reach the server.*" });
    return;
  }

  const { options, truncated } = await listSpeakTargets(guild, member);
  if (options.length === 0) {
    await interaction.editReply({ content: "» *There's nowhere you can speak right now.*" });
    return;
  }

  const { rows, note } = buildSpeakPicker(options, truncated);
  await interaction.editReply({
    content: ["Where would you like to speak?", note].filter(Boolean).join("\n"),
    components: rows,
  });
}

// Picking a destination opens the modal. Legal on a select interaction, and
// the reason the picker exists as its own step at all.
async function handleSpeakPick(interaction) {
  const channelId = interaction.values[0];
  // A group header, not a destination — re-render untouched.
  if (channelId === NAV_VALUE) {
    await interaction.deferUpdate();
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel || !member || !canSpeakIn(channel, member)) {
    await interaction.update({ content: "» *You can't speak there any more.*", components: [] });
    return;
  }

  await interaction.showModal(buildSpeakModal(channelId, `#${channel.name}`));
}

async function handleSpeakSubmit(interaction, channelId) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
  // Re-checked rather than trusted: an ephemeral picker outlives its player
  // walking out of the room.
  if (!channel || !member || !canSpeakIn(channel, member)) {
    await interaction.reply({ content: "» *You can't speak there any more.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const body = interaction.fields.getTextInputValue("say:body").trim();
  const uploads = interaction.fields.getUploadedFiles("say:file");
  const files = [...(uploads?.values() ?? [])].map((a) => a.url);
  if (!body && files.length === 0) {
    await interaction.reply({ content: "» *Write something, or attach something.*", flags: MessageFlags.Ephemeral });
    return;
  }

  // Open to everyone, with nothing equipped and no tag required — a player
  // decides for themselves when to go unnamed, the same posture the /conceal
  // prefix takes.
  const conceal = interaction.fields.getCheckbox("say:conceal")
    ? { alias: concealedAlias(character) }
    : null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let posted;
  try {
    posted = await postAsCharacterTo(channel, character, {
      content: body,
      files,
      discordUserId: interaction.user.id,
      conceal,
    });
  } catch (err) {
    console.error("Failed to post a Speak message:", err);
    await interaction.editReply({ content: "» *Couldn't post that.*" });
    return;
  }

  await recordArchiveMessage(prisma, {
    discordMessageId: posted.webhookMessage.id,
    content: [posted.content, ...files.map(() => "[attachment]")].filter(Boolean).join("\n"),
    character,
    concealedAlias: conceal?.alias ?? null,
    ...resolveChannelContext(channel),
  });

  await interaction.editReply({
    content: `» *Sent.*\n${messageLink(guild.id, channel.id, posted.webhookMessage.id)}`,
  });
}

// /message. Inside a channel the player can already speak in, skip the picker
// and post there — that does not hide the typing indicator (they are already
// in the channel) but it does stop the message existing in plain sight before
// the proxy deletes it. Anywhere else, ask where first.
async function handleMessageCommand(interaction) {
  if (interaction.inGuild()) {
    const { member } = await resolveActingMember(interaction);
    const channel = interaction.channel;
    if (member && channel && canSpeakIn(channel, member)) {
      await interaction.showModal(buildSpeakModal(channel.id, `#${channel.name}`));
      return;
    }
  }
  await handleSpeakOpen(interaction);
}

// --- /heal -----------------------------------------------------------

// GM-only, and deliberately NOT the player medic path
// (web/app/(app)/character/requestActions.js#healCharacterRequest), which
// charges a payer, requires medical-basic and requires co-location. A GM
// clearing an affliction needs none of that.
//
// It also skips isHealable: that predicate hides tier-0 self-limiting
// conditions (Vomiting, a Migraine) from the PLAYER picker, and a GM should
// be able to clear those too. Category is the only filter.
async function handleHealCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const role = interaction.options.getRole("character", true);
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await interaction.reply({ content: "» *That isn't a living character's role.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const afflictions = target.tags.filter((ct) => ct.tag.category === HEALTH_CATEGORY);
  if (afflictions.length === 0) {
    await interaction.reply({ content: `» *${target.name} has nothing to treat.*`, flags: MessageFlags.Ephemeral });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`heal:pick:${target.id}`)
    .setPlaceholder("What to clear...")
    .setMinValues(1)
    .setMaxValues(afflictions.length)
    .addOptions(afflictions.slice(0, 25).map((ct) => ({ label: ct.tag.name, value: ct.tagId })));

  await interaction.reply({
    content: `Clear what from **${target.name}**?`,
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHealPick(interaction, characterId) {
  if (!isGmMember(interaction)) {
    await interaction.update({ content: "» *GMs only.*", components: [] });
    return;
  }
  await interaction.deferUpdate();

  const tagIds = interaction.values;
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await interaction.editReply({ content: "» *That character no longer exists.*", components: [] });
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

  // A tag moved, and #radio/#intercom access is tag-gated.
  const { guild } = await resolveActingMember(interaction);
  if (guild) await syncCharacterNarrowcastAccess(guild, target).catch(() => {});

  await interaction.editReply({
    content: `» *Cleared ${cleared.join(", ")} from ${target.name}.*`,
    components: [],
  });
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
        // The three twins of the #turns console buttons.
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location") return void (await handleOpen(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "labor") {
          const field = interaction.options.getString("type", true);
          if (!LABOR_FIELDS.includes(field)) return;
          return void (await handleLaborCommand(interaction, field));
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleOpen(interaction));
        if (interaction.customId === "loc:cancel") return void (await handleCancel(interaction));
        if (interaction.customId.startsWith("loc:confirm:")) {
          return void (await handleConfirm(interaction, interaction.customId.slice("loc:confirm:".length)));
        }
        if (interaction.customId === "move:open") return void (await handleMoveOpen(interaction));
        if (interaction.customId === "say:open") return void (await handleSpeakOpen(interaction));
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "loc:place") return void (await handlePlaceSelect(interaction));
        if (interaction.customId === "say:pick") return void (await handleSpeakPick(interaction));
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (interaction.customId.startsWith("say:send:")) {
          return void (await handleSpeakSubmit(interaction, interaction.customId.slice("say:send:".length)));
        }
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
    }
  },
};
