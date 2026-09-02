const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { prisma, concealedAlias } = require("@lifeweb/db");
const {
  MENU_OPTION_LIMIT,
  PICK_ID,
  DRAG_PREFIX,
  CONFIRM_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildDragRow,
  buildConfirmRow,
  rememberDrag,
  takeDrag,
  forgetDrag,
  performMove,
} = require("../lib/locationTravel");
const { dragCandidates } = require("@lifeweb/db/lib/locationTravel");
const { reconcileNarrowcastAccess } = require("@lifeweb/db/lib/locationMove");
const { syncCharacterRoomAccess, accessibleRooms, heldTagSlugs } = require("@lifeweb/db/lib/roomAccess");
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
const { messageLink } = require("../lib/mentions");
const { startPrivateThread, addThreadMember } = require("@lifeweb/db/lib/discordRest");
const {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  CONVERSE_PREFIX,
} = require("@lifeweb/db/lib/locationAnchorRow");
const {
  buildConverseModal,
  CONVERSE_MODAL_PREFIX,
  CONVERSE_NAME_FIELD,
} = require("../lib/converseModal");
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

// The conversation-room select, the one custom id in this flow that isn't
// defined next to the component that carries it (the modal's lives in
// bot/src/lib/converseModal.js, the anchor buttons' in
// db/lib/locationAnchorRow.js, the travel flow's in
// bot/src/lib/locationTravel.js).
const CONVERSE_ROOM_PREFIX = "conv:room:";

// "a young man" / "an old woman" — the alias as it reads mid-sentence.
function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

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

// /add and /remove: a Conversation's guest list. /add works on any living
// character wherever they stand — recorded as a PlayerThreadInvite, and
// applied immediately if they are already standing in this Location, else
// replayed by applyPendingInvites on arrival (db/lib/threadInvites.js).
//
// Gated on a PlayerThread row rather than "is this a private thread": a
// private Room is a private thread too, and its guest list is a key tag
// (db/lib/roomAccess.js), not something a player hands out.
async function handleThreadMemberCommand(interaction, action) {
  await ack(interaction);

  const channel = interaction.channel;
  const row = channel
    ? await prisma.playerThread.findUnique({
        where: { threadId: channel.id },
        include: { location: { select: { name: true } } },
      })
    : null;
  if (!row) {
    await respond(interaction, "» *That only works inside a conversation.* ‡");
    return;
  }

  const gm = isGmMember(interaction);
  if (!gm) {
    const member = await channel.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await respond(interaction, "» *You're not in this conversation.* ‡");
      return;
    }
  }

  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
  });
  if (!target) {
    await respond(interaction, "» *That isn't a living character's role.* ‡");
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
      await respond(interaction, "» *Couldn't remove them. The bot may be missing Manage Threads.* ‡");
      return;
    }
    await respond(interaction, `» *${target.name} was removed.* ‡`, { fleeting: true });
    return;
  }

  await prisma.playerThreadInvite
    .upsert({
      where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
      update: {},
      create: { threadId: channel.id, characterId: target.id },
    })
    .catch((err) => console.error("Failed to record thread invite:", err));

  if (target.locationId === row.locationId) {
    try {
      await addThreadMember(channel.id, target.discordUserId);
    } catch (err) {
      console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err);
    }
    await respond(interaction, `» *${target.name} was added.* ‡`, { fleeting: true });
    return;
  }
  await respond(
    interaction,
    `» *${target.name} is invited — they'll see this when they reach ${row.location?.name ?? "this place"}.* ‡`,
    { fleeting: true },
  );
}

// Custom IDs below are "loc:"-namespaced for the travel flow off the Travel
// button on the #turns console (bot/src/lib/turnsConsole.js, whose button
// keeps its historical "loc:open" id) and off the three buttons on every
// Location channel's anchor; "conv:" is the Conversation flow; "move:" and
// "say:" are the unrelated Move and Speak modals.

// loc:open, and its /location twin. Offers the Locations connected to where
// the character stands — or, on a first placement, every Location outside the
// caves, because arriving is not travel.
async function handleTravelOpen(interaction) {
  await ack(interaction);

  const character = await loadMover(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  let current = null;
  let destinations;
  if (!character.locationId) {
    destinations = await prisma.location.findMany({
      where: { zone: { kind: { not: "CAVE_GROUP" } } },
      include: { zone: true },
    });
  } else {
    current = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true, connectsTo: { include: { zone: true } } },
    });
    destinations = [...(current?.connectsTo ?? [])];
  }
  destinations.sort(
    (a, b) => (a.zone?.name ?? "").localeCompare(b.zone?.name ?? "") || a.name.localeCompare(b.name),
  );

  if (destinations.length === 0) {
    await respond(interaction, "» *Nowhere to go from here.* ‡");
    return;
  }

  // Never truncate silently: a missing destination reads as a broken map.
  const truncated = destinations.length - Math.min(destinations.length, MENU_OPTION_LIMIT);
  await respond(interaction, {
    content: [
      "Where would you like to go? ‡",
      truncated > 0 ? `-# ${truncated} more not shown — Discord caps this list at 25. ‡` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    components: [buildLocationSelectRow(destinations, current)],
  });
}

// One message carries both the passenger list and the confirmation, because
// Discord cannot keep them on two: an ephemeral reply is a single editable
// surface, and a second message would leave the first one lying around with
// live buttons on it.
async function handleTravelPick(interaction) {
  await ack(interaction, { update: true });

  const locationId = interaction.values[0];
  forgetDrag(interaction.user.id);

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  if (!target) {
    await respond(interaction, { content: "» *That place no longer exists.* ‡", components: [] });
    return;
  }
  if (!character) {
    await respond(interaction, { content: "» *You don't have a living character.* ‡", components: [] });
    return;
  }

  const candidates = await dragCandidates(prisma, character);
  const dragRow = buildDragRow(locationId, candidates);
  const overflow = candidates.length - Math.min(candidates.length, MENU_OPTION_LIMIT);

  const cost = !character.locationId
    ? "-# Arriving costs you nothing. ‡"
    : character.zoneId === target.zoneId
      ? "-# A step inside the zone is free. ‡"
      : `-# Crossing into ${target.zone.name} spends your Move for this turn. ‡`;

  await respond(
    interaction,
    {
      content: [
        `Move to **${target.name}**?`,
        cost,
        overflow > 0 ? `-# ${overflow} more not shown — Discord caps this list at 25. ‡` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      components: [dragRow, buildConfirmRow(locationId)].filter(Boolean),
    },
    { fleeting: false },
  );
}

// The picked passengers, parked until Confirm. deferUpdate rather than an
// `update` payload because the names have to be read first, and the list is
// re-authorized server-side at Confirm anyway — this is a hint, not a lock.
async function handleTravelDrag(interaction, locationId) {
  await interaction.deferUpdate();

  const ids = interaction.values ?? [];
  rememberDrag(interaction.user.id, locationId, ids);

  const chosen =
    ids.length > 0
      ? await prisma.character.findMany({ where: { id: { in: ids } }, select: { name: true } })
      : [];
  const lines = interaction.message.content
    .split("\n")
    .filter((line) => !line.startsWith("-# Bringing:"));
  if (chosen.length > 0) lines.push(`-# Bringing: ${chosen.map((c) => c.name).join(", ")} ‡`);

  await interaction.editReply({ content: lines.join("\n") }).catch((err) =>
    console.error("Failed to show the drag list:", err),
  );
}

async function handleTravelConfirm(interaction, locationId) {
  await interaction.deferUpdate();

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  const dragged = takeDrag(interaction.user.id, locationId);

  if (!character) {
    await respond(interaction, { content: "» *You don't have a living character.* ‡", components: [] });
    return;
  }
  if (!target) {
    await respond(interaction, { content: "» *That place no longer exists.* ‡", components: [] });
    return;
  }

  const result = await performMove(character, target, dragged);
  if (!result.ok) {
    await respond(interaction, { content: `» *${result.reason}*`, components: [] });
    return;
  }

  const brought = result.moved
    .filter((entry) => entry.character.id !== character.id)
    .map((entry) => entry.character.name);
  const parts = [`» Moved to **${target.name}**.`];
  if (result.spentTurn) parts.push("Your turn is spent.");
  if (result.usedHorse) parts.push("Your mount carried you.");
  if (brought.length > 0) parts.push(`Bringing ${listNames(brought)}.`);

  await respond(interaction, { content: `${parts.join(" ")} ‡`, components: [] });
}

async function handleTravelCancel(interaction) {
  forgetDrag(interaction.user.id);
  await interaction.update({ content: "» *Canceled.* ‡", components: [] });
  scheduleDismiss(interaction);
}

// The green "Who's here?" button on a Location's anchor. Named characters
// first, with their Role for a fellow member of a real faction — the same
// rule the 🔍 inspect gate uses, because Role is same-faction knowledge and
// not Silo authority (FACTIONS.md §4a). Concealed characters are listed
// separately and only as what a stranger could tell at a glance.
async function handleWhosHere(interaction, locationId) {
  await ack(interaction);

  const [viewer, present] = await Promise.all([
    prisma.character.findFirst({
      where: { discordUserId: interaction.user.id, status: "ALIVE" },
      select: { factionId: true },
    }),
    prisma.character.findMany({
      where: { status: "ALIVE", locationId },
      select: {
        name: true,
        roleTitle: true,
        factionId: true,
        concealed: true,
        age: true,
        gender: true,
        faction: { select: { name: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    }),
  ]);

  if (present.length === 0) {
    await respond(interaction, "» *Nobody is here.* ‡");
    return;
  }

  const named = present
    .filter((c) => !c.concealed)
    .map((c) => {
      const sameFaction =
        viewer?.factionId &&
        c.factionId === viewer.factionId &&
        c.faction?.name !== "Unaffiliated" &&
        c.roleTitle;
      return sameFaction ? `${c.name}, ${c.roleTitle}` : c.name;
    });
  // No title on a concealed line: a Role is as identifying as a name.
  const hidden = present
    .filter((c) => c.concealed)
    .map((c) => withArticle(concealedAlias(c).toLowerCase()));

  const lines = [];
  if (named.length > 0) lines.push(`**Here:** ${named.join(" | ")}`);
  if (hidden.length > 0) lines.push(`**Also here:** ${hidden.join(" | ")}`);
  await respond(interaction, `${lines.join("\n")} ‡`);
}

// "Secret rooms?": the doors this character can open here that nobody else
// can see they can. Private Rooms come from the key tags they hold
// (db/lib/roomAccess.js); Conversations come from having opened one or been
// invited to it.
async function handleSecretRooms(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const [rooms, held, invites] = await Promise.all([
    prisma.room.findMany({
      where: { locationId, kind: "PRIVATE", discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true, discordThreadId: true },
      orderBy: { sortOrder: "asc" },
    }),
    heldTagSlugs(prisma, character.id),
    prisma.playerThreadInvite.findMany({
      where: { characterId: character.id },
      select: { threadId: true },
    }),
  ]);

  const mine = accessibleRooms(rooms, held);
  const conversations = await prisma.playerThread.findMany({
    where: {
      locationId,
      OR: [
        { creatorCharacterId: character.id },
        { threadId: { in: invites.map((i) => i.threadId) } },
      ],
    },
    select: { threadId: true },
    orderBy: { createdAt: "asc" },
  });

  const lines = [];
  if (mine.length > 0) {
    lines.push(`**Private Rooms:** ${mine.map((r) => `<#${r.discordThreadId}>`).join(" | ")}`);
  }
  if (conversations.length > 0) {
    lines.push(`**Conversations:** ${conversations.map((c) => `<#${c.threadId}>`).join(" | ")}`);
  }
  if (lines.length === 0) {
    await respond(interaction, "» *No secret rooms for you here.* ‡");
    return;
  }
  await respond(interaction, `${lines.join("\n")} ‡`);
}

// "Converse": the only thread a player can still open. It is linked to a
// Room, and every 15 minutes that Room hears somebody is whispering
// (bot/src/lib/whisperPoll.js) — which is what keeps a private thread from
// being a place nobody can tell is happening.
async function handleConverseOpen(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }
  if (character.locationId !== locationId) {
    await respond(interaction, "» *You're not there any more.* ‡");
    return;
  }

  const [rooms, held] = await Promise.all([
    prisma.room.findMany({
      where: { locationId, discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true },
      orderBy: { sortOrder: "asc" },
    }),
    heldTagSlugs(prisma, character.id),
  ]);
  const options = accessibleRooms(rooms, held).slice(0, MENU_OPTION_LIMIT);
  if (options.length === 0) {
    await respond(interaction, "» *There's no room here to hold a conversation in.* ‡");
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${CONVERSE_ROOM_PREFIX}${locationId}`)
    .setPlaceholder("Which room is this linked to? ‡")
    .addOptions(
      options.map((room) => ({
        label: room.name.slice(0, 100),
        value: room.id,
        ...(room.kind === "PRIVATE" ? { description: "Private ‡" } : {}),
      })),
    );

  await respond(interaction, {
    content: "Which room is this linked to? ‡\n-# That room hears that someone is whispering, never who. ‡",
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// nothing is awaited here — every gate runs on submit.
async function handleConverseRoomPick(interaction) {
  await interaction.showModal(buildConverseModal(interaction.values[0]));
}

async function handleConverseCreate(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { location: true },
  });
  if (!room) {
    await respond(interaction, "» *That room no longer exists.* ‡");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `» *You're not in ${room.location.name} any more.* ‡`);
    return;
  }
  if (!room.location.discordChannelId) {
    await respond(interaction, "» *That place has no channel yet — tell a GM.* ‡");
    return;
  }

  const name = interaction.fields.getTextInputValue(CONVERSE_NAME_FIELD).trim().slice(0, 90);
  if (!name) {
    await respond(interaction, "» *Give it a name.* ‡");
    return;
  }

  // The thread hangs off the LOCATION channel, not the room thread: Discord
  // has no threads inside threads. The room is the link the whisper poll
  // reads, nothing more.
  let thread;
  try {
    thread = await startPrivateThread(room.location.discordChannelId, name);
    await addThreadMember(thread.id, interaction.user.id);
  } catch (err) {
    console.error(`Failed to open a conversation in ${room.location.name}:`, err);
    await respond(interaction, "» *Couldn't open that — try again, or tell a GM.* ‡");
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  await prisma.playerThread.create({
    data: {
      threadId: thread.id,
      name,
      locationId: room.locationId,
      roomId: room.id,
      creatorCharacterId: character.id,
      creatorDiscordUserId: character.discordUserId,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId,
        actionType: "conversation_opened",
        targetCharacterId: character.id,
        details: { threadId: thread.id, name, room: room.name, location: room.location.name },
      },
    })
    .catch((err) => console.error("Conversation audit log failed:", err));

  await respond(interaction, `» *Opened.* ‡\n<#${thread.id}>`, { fleeting: true });
}

// /conceal: a standing state, not a per-message prefix. While it is on, every
// message proxies under the alias with the unknown silhouette, and Who's here
// lists the alias instead of the name.
async function handleConcealCommand(interaction) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "» *You don't have a living character.* ‡");
    return;
  }

  const concealed = !character.concealed;
  await prisma.character.update({ where: { id: character.id }, data: { concealed } });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "character_conceal_toggled",
        targetCharacterId: character.id,
        details: { concealed },
      },
    })
    .catch((err) => console.error("Conceal audit log failed:", err));

  await respond(
    interaction,
    concealed
      ? `» *You now speak as **${withArticle(concealedAlias(character).toLowerCase())}**. Nobody sees your name until you run /conceal again.* ‡`
      : "» *You speak under your own name again.* ‡",
  );
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

  // Read off the character, never off the modal: concealment is a standing
  // state now, and a checkbox here would be a second answer to a settled
  // question.
  const conceal = character.concealed ? { alias: concealedAlias(character) } : null;

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

  // Clearing an affliction can change both narrowcast access and which
  // private Rooms this character belongs in — a key tag is a tag like any
  // other, and #watch/#intercom are gated on tags too.
  await reconcileNarrowcastAccess(prisma, target.id, target.discordUserId).catch((err) =>
    console.error(`Heal: narrowcast reconcile failed for ${target.name}:`, err.message ?? err),
  );
  await syncCharacterRoomAccess(prisma, target).catch((err) =>
    console.error(`Heal: room access sync failed for ${target.name}:`, err.message ?? err),
  );

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
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location") return void (await handleTravelOpen(interaction));
        if (interaction.commandName === "conceal") return void (await handleConcealCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "roll") return void (await handleRollCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleTravelOpen(interaction));
        if (interaction.customId === CANCEL_ID) return void (await handleTravelCancel(interaction));
        if (interaction.customId.startsWith(CONFIRM_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(CONFIRM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(WHOS_HERE_PREFIX)) {
          return void (await handleWhosHere(interaction, interaction.customId.slice(WHOS_HERE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(SECRET_ROOMS_PREFIX)) {
          return void (await handleSecretRooms(interaction, interaction.customId.slice(SECRET_ROOMS_PREFIX.length)));
        }
        if (interaction.customId.startsWith(CONVERSE_PREFIX)) {
          return void (await handleConverseOpen(interaction, interaction.customId.slice(CONVERSE_PREFIX.length)));
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
        if (interaction.customId === PICK_ID) return void (await handleTravelPick(interaction));
        if (interaction.customId.startsWith(DRAG_PREFIX)) {
          return void (await handleTravelDrag(interaction, interaction.customId.slice(DRAG_PREFIX.length)));
        }
        // Must NOT be acked first: it opens a modal.
        if (interaction.customId.startsWith(CONVERSE_ROOM_PREFIX)) {
          return void (await handleConverseRoomPick(interaction));
        }
        if (interaction.customId === "say:pick") return void (await handleSpeakPick(interaction));
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (interaction.customId.startsWith(CONVERSE_MODAL_PREFIX)) {
          return void (await handleConverseCreate(interaction, interaction.customId.slice(CONVERSE_MODAL_PREFIX.length)));
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
