const { prisma } = require("@lifeweb/db");
const { readBlock } = require("@lifeweb/db/lib/reading");
const { paperDescription } = require("@lifeweb/db/lib/paper");
const { addToStack, dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { expiryFrom } = require("@lifeweb/db/lib/turnFormat");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const {
  BOARD_OPTION_LIMIT,
  boardText,
  hasNoticeboard,
  pinnedLine,
  tornLine,
} = require("@lifeweb/db/lib/noticeboard");
const { ack, respond } = require("./respond");
const { resolveActingMember } = require("./interactionGuild");
const { postMessage } = require("@lifeweb/db/lib/discordRest");

// The Noticeboard button on a Location's anchor, and the three things it
// offers. See docs/systemdocs/PAPERWORK.md.
//
// EVERYTHING IS EPHEMERAL except the ambient line a pin raises. A board is
// public, but reading one is not a performance, and an ephemeral panel means
// five people can be at the same board without a wall of bot messages.
//
// THREE SELECTS RATHER THAN BUTTONS PER NOTICE. Discord allows five action rows
// per message, so a Read/Tear pair per paper would overflow the board at three
// notices. Selects have no such cap and read better besides — you pick the
// paper, then the verb is the menu you picked it from.

const READ_PREFIX = "notice:read:";
const TEAR_PREFIX = "notice:tear:";
const PIN_PREFIX = "notice:pin:";

// Everything the three handlers need: who is acting, where the board is, and
// whether they are standing at it.
async function boardContext(interaction, locationId) {
  const member = await resolveActingMember(interaction);
  const [location, openTurn] = await Promise.all([
    prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, indoors: true, attributes: true, discordChannelId: true },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
  ]);
  if (!location) return { error: "That place is gone. ‡" };
  if (!hasNoticeboard(location)) return { error: "There's no board here. ‡" };

  const character = member
    ? await prisma.character.findFirst({
        where: { discordUserId: member.id, status: "ALIVE" },
        include: { tags: { include: { tag: true } } },
      })
    : null;
  // Standing here is the whole permission model. You cannot read a board from
  // three zones away, and you cannot pin to one either.
  if (!character || character.locationId !== location.id) {
    return { error: "You're not here. ‡" };
  }

  const posts = await prisma.noticePost.findMany({
    where: { locationId: location.id },
    orderBy: { expiresTurn: "asc" },
    take: BOARD_OPTION_LIMIT,
    include: { tag: true },
  });

  return {
    location,
    character,
    openTurn,
    posts,
    where: { phase: openTurn?.phase ?? null, indoors: location.indoors ?? true },
  };
}

function selectRow(customId, placeholder, options) {
  if (options.length === 0) return null;
  return {
    type: 1,
    components: [{ type: 3, custom_id: customId, placeholder, options }],
  };
}

async function handleNoticeboardOpen(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error, ephemeral: true });

  const { location, character, posts, openTurn } = ctx;

  // Written or sealed, and never gated on whether they can read it. Pinning up
  // a letter you cannot read yourself is a perfectly good thing to do with one.
  const holding = character.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .slice(0, BOARD_OPTION_LIMIT);

  const noticeOptions = posts.map((p) => ({ label: p.tag.name.slice(0, 100), value: p.id }));
  const rows = [
    selectRow(`${READ_PREFIX}${location.id}`, "Read a notice… ‡", noticeOptions),
    selectRow(`${TEAR_PREFIX}${location.id}`, "Tear one down… ‡", noticeOptions),
    selectRow(
      `${PIN_PREFIX}${location.id}`,
      "Pin a paper… ‡",
      holding.map((ct) => ({
        label: ct.tag.name.slice(0, 100),
        value: ct.tagId,
        description: ct.tag.paperKind === "SEALED" ? "Sealed" : undefined,
      })),
    ),
  ].filter(Boolean);

  return respond(interaction, {
    content: boardText(location.name, posts, openTurn?.number ?? 0),
    ephemeral: true,
    components: rows,
  });
}

async function handleNoticeRead(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error, ephemeral: true });

  const post = ctx.posts.find((p) => p.id === interaction.values?.[0]);
  if (!post) return respond(interaction, { content: "It's gone. ‡", ephemeral: true });

  // The same predicate the tag chip uses, and the same sentence — a blind
  // reader and an illiterate one get identical refusals, so neither the reader
  // nor anyone watching learns which it was.
  const text = paperDescription(post.tag, { tags: ctx.character.tags, ...ctx.where });
  const blocked = readBlock(ctx.character.tags, ctx.where);

  // A code block, because a notice is a thing with edges — and because it
  // stops anything written on it rendering as Discord markup or pinging
  // somebody. Nobody is told it was read.
  const content = blocked || post.tag.paperKind === "SEALED" ? text : `\`\`\`\n${text}\n\`\`\``;
  return respond(interaction, { content, ephemeral: true });
}

async function handleNoticeTear(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error, ephemeral: true });

  const post = ctx.posts.find((p) => p.id === interaction.values?.[0]);
  if (!post) return respond(interaction, { content: "It's gone. ‡", ephemeral: true });

  // The delete IS the claim, so two people tearing at the same paper cannot
  // both walk away with it — the same shape every other race here uses.
  const claimed = await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) {
    return respond(interaction, { content: "Somebody got there first. ‡", ephemeral: true });
  }
  await addToStack(prisma, ctx.character.id, post.tagId, 1, {});

  if (ctx.location.discordChannelId) {
    // Catch-logged: an unreachable channel must never undo a tear that has
    // already committed (ARCHITECTURE.md §5).
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => {});
  }
  return respond(interaction, { content: `You take ${post.tag.name} down. ‡`, ephemeral: true });
}

async function handleNoticePin(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error, ephemeral: true });
  if (!ctx.openTurn) return respond(interaction, { content: "Nothing is happening yet. ‡", ephemeral: true });

  const tagId = interaction.values?.[0];
  const held = ctx.character.tags.find((ct) => ct.tagId === tagId);
  // The same two kinds the picker above offers. "has a paperKind" is not the
  // check: a spent envelope and a bound book both have one, and neither goes
  // up on a wall.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return respond(interaction, { content: "You aren't holding that. ‡", ephemeral: true });
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  // N turns means N turns, counting the one it went up in — the same
  // arithmetic every other clock in the game uses (db/lib/turnFormat.js).
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  try {
    await prisma.$transaction(async (tx) => {
      // NoticePost.tagId is @unique: a paper is on a board or in somebody's
      // hands, never both. Creating first means a paper already pinned
      // somewhere else fails here rather than being silently taken off a
      // sheet and lost.
      await tx.noticePost.create({
        data: {
          locationId: ctx.location.id,
          tagId: held.tagId,
          postedById: ctx.character.id,
          postedTurn: ctx.openTurn.number,
          expiresTurn,
        },
      });
      await dropCharacterTag(tx, ctx.character.id, held.tagId, 1);
    });
  } catch (err) {
    if (err?.code === "P2002") {
      return respond(interaction, { content: "That one is already up somewhere. ‡", ephemeral: true });
    }
    throw err;
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => {});
  }
  return respond(interaction, {
    content: `You nail ${held.tag.name} up. Anyone here can read it, or take it down. ‡`,
    ephemeral: true,
  });
}

module.exports = {
  READ_PREFIX,
  TEAR_PREFIX,
  PIN_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
};
