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
const { OPEN_BUTTON_ID: REPORT_OPEN_ID, CLOSE_BUTTON_ID: REPORT_CLOSE_ID } = require("@lifeweb/db/lib/reportChannelAccess");

// Discord's hard cap on select-menu options, and on max_values with them.
const MENU_OPTION_LIMIT = 25;

// /gm: post to the current channel as the bot itself, not the invoker's
// character — the slash-command replacement for the old ":gm" message
// prefix (deleted the invoker's message and reposted it; a slash command
// has no message of its own to delete, so it just sends directly).
async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
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
  await respond(interaction, "» *Sent.*", { fleeting: true });
}

// /dm: DM a chosen server member as the bot itself. Was /message, renamed
// when /message became the player-facing "speak as your character" command.
// Reuses bot/src/lib/dm.js#sendDm so it's logged to DirectMessage like every
// other bot-sent DM, and carries the "»" prefix inline since this is a
// bot-composed DM (see the "Bot message style" note in CLAUDE.md).
async function handleGmDmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "» *GMs only.*");
    return;
  }
  // A DM costs two round trips (open the channel, post), which is most of the
  // three-second budget on its own.
  await ack(interaction);

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`, { authorDiscordUserId: interaction.user.id, source: "gm_slash" });
    await respond(interaction, `» *Sent to ${recipient}.*`, { fleeting: true });
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

// /labor is gone — laboring is the checkbox on the Move modal now. This stub
// only exists for the ~1h a removed global command can linger in a client's
// picker while Discord propagates the deregistration; without it a stale
// click would read as "The application did not respond" instead of an
// answer. Delete this branch (and its dispatch case below) once that window
// has passed.
async function handleLaborStub(interaction) {
  await ack(interaction);
  await respond(interaction, "» *Laboring is now a checkbox on your Move — press the ⚜️ button or use /move.*");
}

// /add and /remove: the private-thread guest list. Both take a ROLE option so
// the picker names characters rather than Discord accounts (see
// bot/src/lib/commands.js), and both refuse outside a private thread.
//
// Anyone already in the thread may add or remove, plus GMs — the same posture
// as pinging someone in, which any participant can already do.
//
// /add works on ANY living character, wherever they stand. The invite is
// recorded as a PlayerThreadInvite row, and the Discord thread-member add is
// attempted immediately: it lands if they can already see the zone, and
// otherwise applyPendingInvites replays it the moment they arrive
// (db/lib/threadInvites.js). No ping, no DM — being brought into a room
// should be discovered, not announced.
async function handleThreadMemberCommand(interaction, action) {
  const channel = interaction.channel;
  if (!isPrivateThread(channel)) {
    await respond(interaction, "» *That only works inside a private thread.*");
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
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: channel.id, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err));
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
    await respond(interaction, `» *${target.name} was removed.*`, { fleeting: true });
    return;
  }

  // The invite row FIRST — it is what survives when the Discord add can't
  // land yet, and what applyPendingInvites replays on the target's arrival.
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
    // channel.members.add would ping-mention them; the REST thread-members
    // endpoint adds silently.
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
//
// The source of truth is PlayerThread.persistent in the DB — the wipe reads
// the column, never a Discord marker, so a hand-stripped forum tag can't make
// a standing side-room vanish. On a forum post the Persistent tag is still
// mirrored for visibility; a private thread carries no marker at all (the old
// ⏰ name prefix, and its two-renames-per-ten-minutes bucket, are gone).
//
// The sync-owned posts refuse: a Location topic and the Create-a-Topic anchor
// never wipe and never expire, and that isn't a player's to change. Checked
// against the recorded thread ids, not tags — a hand-edited tag opens no
// hole.
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
    await respond(interaction, "» *That only works inside a forum post or a private thread.*");
    return;
  }

  // Deferred before anything else: the DB round trips plus the forum-tag
  // mirror (a channel GET and possibly a PATCH) can outlast the three-second
  // window under load.
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
    // A thread with no row predates the rework or was made by a GM by hand —
    // adopt it, the same posture the Dawn wipe takes.
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

  const persistent = !row.persistent;
  await prisma.playerThread.update({ where: { id: row.id }, data: { persistent } });

  // The visible mirror, forum posts only. A failed mirror logs but never
  // fails the command — the DB is the truth the wipe reads.
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

// ensureForumTag rather than getForumTagId: a forum channel provisioned before
// the Persistent tag existed would otherwise fail silently here, and this
// creates it idempotently instead.
async function mirrorPersistentTag(thread, persistent) {
  const tagId = await ensureForumTag(thread.parentId, PERSISTENT_TAG_NAME, null);
  if (!tagId) throw new Error(`No ${PERSISTENT_TAG_NAME} tag available on ${thread.parentId}`);

  const current = thread.appliedTags ?? [];
  const has = current.includes(tagId);
  if (persistent === has) return;
  await thread.setAppliedTags(persistent ? [...current, tagId] : current.filter((id) => id !== tagId));
}

// All custom IDs below are namespaced "zone:" for the travel flow triggered
// from the Travel button on the #turns console
// (bot/src/lib/turnsConsole.js; the button itself keeps its historical
// "loc:open" id so the standing console message still works) — "move:" and
// "say:" IDs further down are the unrelated Move and Speak modals.
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

  // An unset zone (brand-new character) can freely pick any presence zone to
  // start in; otherwise the picker only offers the current zone's direct
  // neighbors (Zone.connectsTo). The Caves group is never a destination.
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
  // deferUpdate rather than deferReply: this edits the picker in place, and a
  // deferReply would post a second "thinking" message above it.
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
  await interaction.update({ content: "» *Cancelled.*", components: [] });
  scheduleDismiss(interaction);
}

// --- Create a Topic / Create a Private Thread -------------------------
//
// The two anchor buttons of the zone rework (db/lib/zoneAnchorRow.js): the
// pinned Create-a-Topic post in each zone forum, and the permanent message
// in each #private. Players hold no create-posts / create-threads permission
// anywhere — the bot makes every thread, which is what keeps PlayerThread a
// complete record (persistence, expiry, invites all hang off it).

// showModal IS the acknowledgement and a deferred interaction can no longer
// open one, so nothing is read before it — mirror of handleMoveOpen. The
// gates run on submit.
async function handleTopicOpen(interaction, zoneId) {
  await interaction.showModal(buildTopicModal(zoneId));
}

async function handlePrivateOpen(interaction, zoneId) {
  await interaction.showModal(buildPrivateModal(zoneId));
}

// The green "Who's here?" button (db/lib/zoneAnchorRow.js) on a zone's
// Create-a-Topic anchor and every generated Location post. Replies privately
// with just the names of every ALIVE character standing in the zone —
// nothing more — plus a same-faction Role, mirroring the gate the bot's 🔍
// inspect embed uses (bot/src/events/messageReactionAdd.js): Role is
// same-faction knowledge, not Silo authority (FACTIONS.md §4a).
//
// No extra gate on the button itself: the forum it lives in is already
// visible only to that zone's role, so this reveals nothing a press couldn't
// already reach. It touches the database, so it acks like any other handler
// rather than opening a modal.
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

// Shared gates for both submit handlers: a living character, standing in the
// zone whose button was pressed. The button lives in a channel only that
// zone's role can see, but a button is a hint, not a lock — the ephemeral
// picker outlives its player walking out of the zone.
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
  // FIRST — the forum-post create plus two DB writes can outlast the window.
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
    // The opening mention is what puts the new topic in the creator's
    // mentions so they can find it, and makes them a follower.
    thread = await createForumPost(zone.discordPublicChannelId, {
      name,
      content: `<@${interaction.user.id}> opened this scene.`,
      appliedTags,
    });
  } catch (err) {
    console.error(`Failed to create a topic in ${zone.name}:`, err);
    await respond(interaction, "» *Couldn't create that — try again, or tell a GM.*");
    return;
  }

  await recordPlayerThread({ threadId: thread.id, kind: "PUBLIC", name, zone, character, persistent, openTurn });
  await respond(interaction, `» *Opened.*\n${messageLink(interaction.guildId, zone.discordPublicChannelId, thread.id)}`, {
    fleeting: true,
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
  // — another write and another audit row. At launch-day pool contention that
  // can pass three seconds, and the player then saw "The application did not
  // respond" for a Move that had gone through. Trying again told them they'd
  // already acted.
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
  // bot/src/lib/zoneTravel.js#performMove) — changing zones spends the turn
  // just like a Move submission does.
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

  // Labor rides a Routine only — a Gambit is a deliberate risk, and stacking
  // guaranteed income on top of one would make the risk free. Refused here,
  // in memory, before any lookup: the turn must not be spent for this.
  if (labor && moveKind === "GAMBIT") {
    await respond(
      interaction,
      "» *If you choose to Labor on a turn, you can only do that — Laboring has to be a Routine work.*",
    );
    return;
  }

  // Resolved here rather than at confirm, for two reasons: the turn is spent
  // by the Action row existing, so the depths gate has to run before we
  // create one (a refusal must cost nothing); and resolving now means only
  // one grammar — a plain range — ever reaches the database.
  let resourceRollExpression = null;
  let laborTier = null;
  if (labor) {
    const rate = await resolveLaborRate(prisma, character.id);
    if (!rate.ok) {
      await respond(interaction, `» *${rate.reason}*`);
      return;
    }
    resourceRollExpression = rate.expression;
    laborTier = rate.tier;
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
      // What performLabor used to log — labor + the resolved tier — now
      // recorded on the ordinary Move audit row instead of a separate one.
      details: { actionId: action.id, labor, tier: laborTier },
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

  // A tag moved, and #watch/#intercom access is tag-gated.
  const { guild } = await resolveActingMember(interaction);
  if (guild) await syncCharacterNarrowcastAccess(guild, target).catch(() => {});

  await respond(interaction, {
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
        // Stub only — see handleLaborStub. Delete once the deregistration
        // has propagated (up to 1h after deploy).
        if (interaction.commandName === "labor") return void (await handleLaborStub(interaction));
      } else if (interaction.isButton()) {
        // "loc:open" survives from the pre-zone console message; the rest of
        // the travel flow is "zone:"-namespaced.
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
        if (interaction.customId === REPORT_OPEN_ID) return void (await handleReportOpen(interaction));
        if (interaction.customId === REPORT_CLOSE_ID) return void (await handleReportClose(interaction));
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
  // respond() never throws on its own — it logs and returns — which is what
  // this catch-all needs: the interaction token may already be dead (a modal
  // that timed out, a 3-second miss), and there is nothing left to say then.
  await respond(interaction, { content: "» *Something went wrong — that didn't go through.*", components: [] });
}
