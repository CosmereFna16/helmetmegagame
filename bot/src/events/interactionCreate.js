const { ChannelType, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma, LABOR_FIELDS, FIELD_INFO, concealedAlias } = require("@lifeweb/db");
const { buildLocationSelectRow, buildConfirmRow, performMove, syncCharacterNarrowcastAccess } = require("../lib/location");
const { performLabor } = require("../lib/labor");
const { sendDm } = require("../lib/dm");
const { buildMoveModal } = require("../lib/moveModal");
const { confirmMove } = require("../lib/moveConfirm");
const { buildSpeakModal, buildSpeakPicker } = require("../lib/speakModal");
const { listSpeakTargets, canSpeakInTarget, canSpeakInChannel, isNavValue } = require("../lib/speakTargets");
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
const { ack, respond } = require("../lib/respond");

// Discord's hard cap on select-menu options, and on max_values with them.
const MENU_OPTION_LIMIT = 25;

// /gm: post to the current channel as the bot itself, not the invoker's
// character — the slash-command replacement for the old ":gm" message
// prefix (deleted the invoker's message and reposted it; a slash command
// has no message of its own to delete, so it just sends directly).
async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }
  // Deferred before the send: re-uploading an attachment through Discord can
  // outlast the three seconds an unacknowledged interaction gets.
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
  await respond(interaction, "» *Sent.*");
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
  // A DM costs two round trips (open the channel, post), which is most of the
  // three-second budget on its own.
  await ack(interaction);

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`);
    await respond(interaction, `» *Sent to ${recipient}.*`);
  } catch (err) {
    console.error("Failed to send /dm DM:", err);
    // The catch used to report every failure as "they may have DMs closed",
    // which sent GMs chasing a problem that wasn't there — an over-length
    // message reads identically. 50007 is the real closed-DMs code.
    const closed = err.code === 50007 || err.status === 403;
    await respond(
      interaction,
      closed
        ? "» *Couldn't deliver that — they have DMs closed.*"
        : "» *Couldn't deliver that. It wasn't their DM settings; check the logs.*",
    );
  }
}

// /labor <type>: any player with a living, un-acted character can use it —
// no GM gate. `type` is the LABOR_FIELDS key. See
// bot/src/lib/labor.js#performLabor for the tag-tier lookup, the location
// gate and the auto-resolved Action creation.
async function handleLaborCommand(interaction, field) {
  // FIRST, before any query. performLabor writes an Action, applies the move
  // effects and files an audit row, all inside a transaction — under
  // launch-day pool contention that can pass three seconds, and then the
  // player saw "The application did not respond" for work that had already
  // committed. Retrying told them they'd already acted.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const result = await performLabor(character, field);
  if (!result.ok) {
    await respond(interaction, `» *${result.reason}*`);
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

  await respond(interaction, lines.join("\n"));
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
  // Deferred before the member fetch: on a cache miss that is a REST round
  // trip, and the add/remove below is another.
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
    // Caught rather than left to the outer handler, which only logs — the
    // likely failure is the bot lacking MANAGE_THREADS on this channel, and
    // the invoker would otherwise just see "the application did not respond".
    try {
      await channel.members.remove(target.discordUserId);
    } catch (err) {
      console.error(`Failed to remove ${target.discordUserId} from thread ${channel.id}:`, err);
      await respond(interaction, "» *Couldn't remove them. The bot may be missing Manage Threads.*");
      return;
    }
    await respond(interaction, `» *${target.name} was removed.*`);
    return;
  }

  // Location-scoped rather than Zone-scoped, and not a choice: Discord needs
  // the target to be able to view the thread's parent channel, which only
  // holds while they're standing in that Location.
  const context = resolveChannelContext(channel);
  if (!canJoinThread(target, context)) {
    await respond(
      interaction,
      `» *${target.name} isn't in ${context.locationName ?? "this location"} — they can't be brought in.*`,
    );
    return;
  }

  try {
    await channel.members.add(target.discordUserId);
  } catch (err) {
    console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err);
    await respond(interaction, "» *Couldn't add them — they may not be able to see this location.*");
    return;
  }
  await respond(interaction, `» *${target.name} was added.*`);
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

  // Deferred before anything else, and this command needs it more than any
  // other: renaming a thread sits in a Discord bucket of TWO PER TEN MINUTES
  // per thread, so toggling /persistent twice on the same thread parks the
  // second rename behind a multi-minute wait inside discord.js's queue. The
  // three-second window died every time and the player always saw "the
  // application did not respond", even though the rename eventually landed.
  // Not load-dependent — reproducible on demand. A deferred token lasts
  // fifteen minutes, which covers it.
  //
  // The forum branch is no better: ensureForumTag is a channel GET and
  // possibly a PATCH before the tag is even applied.
  await ack(interaction);

  if (!isGmMember(interaction) && !(await findAliveCharacter(interaction.user.id))) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  let persistent;
  try {
    persistent = forumPost ? await toggleForumPostTag(channel) : await togglePrivateThreadPrefix(channel);
  } catch (err) {
    console.error(`Failed to toggle persistence on thread ${channel.id}:`, err);
    await respond(interaction, "» *Couldn't change that — the bot may be missing Manage Threads here.*");
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

  await respond(
    interaction,
    persistent
      ? "» *This thread will now survive the Dawn wipe — its messages still get cleared.*"
      : "» *This thread is no longer persistent, and will be removed at Dawn.*",
  );
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
  // The Travel button on the #turns console, which every player presses within
  // a minute of turn open. Two queries before the first ack was the whole
  // three-second budget under that kind of pool contention.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
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
    await respond(interaction, "» *Nowhere to go from here.*");
    return;
  }

  await respond(interaction, {
    content: "Where would you like to move? Choose a location.",
    components: [buildLocationSelectRow(locations, currentLocation)],
  });
}

async function handlePlaceSelect(interaction) {
  // deferUpdate rather than deferReply: this edits the picker in place, and a
  // deferReply would post a second "thinking" message above it.
  await ack(interaction, { update: true });

  const locationId = interaction.values[0];
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await respond(interaction, { content: "» *That location no longer exists.*", components: [] });
    return;
  }

  await respond(interaction, {
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
  // FIRST. This is the handler with the most to lose: by the time it replies
  // it has read the character, the open turn and any prior Action, created the
  // Action row, written an audit entry, re-read with tags, and run confirmMove
  // — which is another transaction, another audit row, and the resource push.
  // At launch-day pool contention that can pass three seconds, and the player
  // then saw "The application did not respond" for a Move that had gone
  // through. Trying again told them they'd already acted.
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

  // Also catches a prior auto-resolved zone-change Move (see
  // bot/src/lib/location.js#performMove) — changing zones spends the turn
  // just like a Move submission does.
  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (alreadyActed) {
    await respond(interaction, "» *You've already sent a Move this turn — your submission wasn't recorded.*");
    return;
  }

  const raw = interaction.fields.getTextInputValue("move:body").trim();
  if (!raw) {
    await respond(interaction, "» *Write something first.*");
    return;
  }

  const moveKind = interaction.fields.getRadioGroup("move:kind");
  const opposed = optionalCheckbox(interaction, "move:opposed");

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
      await respond(interaction, `» *${rate.reason}*`);
      return;
    }
    resourceRollExpression = rate.expression;
  }

  // @@unique([characterId, turnId]) is the real gate; the earlier openTurn/
  // already-acted check is the friendly one. A retried interaction at rollover
  // lands here twice, and the second must not become a second Move.
  let action;
  try {
    action = await prisma.action.create({
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
  } catch (err) {
    if (err.code === "P2002") {
      await respond(interaction, "» *You've already acted this turn.*");
      return;
    }
    throw err;
  }

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
  // respond() clamps to 2000. It has to: the first line echoes the player's
  // description, the modal allows 1800 characters, and the Kind, dice and
  // resource-roll lines go on top — so the reply could exceed the limit by
  // typing, and did so AFTER the Move was already committed and paid out.
  await respond(interaction, lines.join("\n"));
}

// --- Speak -----------------------------------------------------------

// A modal field that is setRequired(false) may be absent from the submitted
// payload entirely, and every fields.getX() throws on a component it cannot
// find. An attachment-only post is legal, so reading the optional fields must
// never be what breaks it.
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

// Picking a destination opens the modal. A modal must be shown within 3
// seconds and cannot be deferred first, so NOTHING is awaited here — the
// channel name is read from the cache if it happens to be there, and the
// permission re-check lives on submit, which is the real security boundary
// anyway.
async function handleSpeakPick(interaction) {
  const targetId = interaction.values[0];
  // A group header, not a destination — re-render untouched.
  if (isNavValue(targetId)) {
    await interaction.deferUpdate();
    return;
  }

  const cached = interaction.client.channels.cache.get(targetId);
  await interaction.showModal(buildSpeakModal(targetId, cached ? `#${cached.name}` : null));
}

async function handleSpeakSubmit(interaction, channelId) {
  // Moved to the top. The defer used to sit three awaits down — a character
  // lookup, a member resolve that can hit REST on a cache miss, and a channel
  // fetch — any of which can outlast the three-second window on its own.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.*");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  // client.channels rather than guild.channels: the destination may be a
  // thread, which never sits in the guild channel cache.
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  // Re-checked rather than trusted: an ephemeral picker outlives its player
  // walking out of the room. canSpeakInTarget picks the channel-vs-thread
  // permission by what it was handed.
  if (!guild || !channel || !member || !canSpeakInTarget(channel, member)) {
    await respond(interaction, "» *You can't speak there any more.*");
    return;
  }

  const body = optionalText(interaction, "say:body").trim();
  if (!body) {
    await respond(interaction, "» *Write something.*");
    return;
  }

  // Open to everyone, with nothing equipped and no tag required — a player
  // decides for themselves when to go unnamed, the same posture the /conceal
  // prefix takes.
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
    await interaction.editReply({ content: "» *Couldn't post that.*" });
    return;
  }

  await recordArchiveMessage(prisma, {
    discordMessageId: posted.webhookMessage.id,
    content: posted.content,
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
  // interaction.member is already populated in a guild, so this branch reaches
  // showModal with nothing awaited — see handleSpeakPick for why that matters.
  const channel = interaction.channel;
  if (interaction.inGuild() && interaction.member && channel && canSpeakInTarget(channel, interaction.member)) {
    await interaction.showModal(buildSpeakModal(channel.id, `#${channel.name}`));
    return;
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

  // Discord caps a select menu at 25 options AND caps max_values at the number
  // of options present. The options were already sliced; setMaxValues wasn't,
  // so a character carrying 26 afflictions made Discord reject the whole
  // component and the GM couldn't heal them at all — the failure being total
  // rather than partial is what made this worth fixing.
  const shown = afflictions.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`heal:pick:${target.id}`)
    .setPlaceholder("What to clear...")
    .setMinValues(1)
    .setMaxValues(shown.length)
    .addOptions(shown.map((ct) => ({ label: ct.tag.name, value: ct.tagId })));

  // Said out loud rather than silently dropped, the way the Speak picker does
  // it: a GM who can't find an affliction should know the list was cut, not
  // wonder whether they misremembered.
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

  // A tag moved, and #watch/#intercom access is tag-gated.
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
      // An unanswered interaction sits on "thinking..." forever, which is how
      // a rejected payload once read as a hang instead of an error. Always
      // close the loop, and never let the error path throw on top of the
      // error it is reporting.
      await respondToFailure(interaction);
    }
  },
};

async function respondToFailure(interaction) {
  if (!interaction.isRepliable?.()) return;
  const content = "» *Something went wrong — that didn't go through.*";
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, components: [] });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // The interaction token may already be dead (a modal that timed out, a
    // 3-second miss). Nothing left to say to the user.
  }
}
