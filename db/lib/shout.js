// What a shout sounds like from N places away.
//
// Pure — no prisma, no I/O — so both faces could use it, though only the bot
// does today. db/lib/locationGraph.js#soundRange answers WHO hears; this file
// answers WHAT they hear.
//
// The shape of the rule is that distance takes the words away before it takes
// the direction away. You always learn which way to run. You stop learning
// what was said. Nobody ever learns WHO shouted, at any distance including
// zero — which is what lets a concealed character yell without unmasking.

const { ambientLine } = require("./ambientLine");

// Light, medium, heavy — picked at random per character so a muffled line
// looks like static rather than like a censor bar.
const BLOCKS = ["░", "▒", "▓"];

// Replaces `fraction` of the NON-WHITESPACE characters with a block. Spaces
// survive on purpose: the word shapes are what tells a listener how much they
// missed, and a solid bar of noise reads as no message at all rather than as a
// message they failed to catch.
function muffle(text, fraction) {
  if (fraction <= 0) return text;
  return String(text)
    .split("")
    .map((ch) => {
      if (/\s/.test(ch)) return ch;
      if (Math.random() >= fraction) return ch;
      return BLOCKS[Math.floor(Math.random() * BLOCKS.length)];
    })
    .join("");
}

// How much is lost at each remove. Index is the hop count; past the end of the
// table the words are gone entirely and only the direction survives.
const MUFFLE_BY_DISTANCE = [0, 0, 0.4, 0.7];

// The line one Location gets. `viaName` is the hearer's own neighbour toward
// the noise, and is null only at distance 0 (where you are standing in it).
//
// Distance 0 is FULL SIZE and everything beyond it is `-#` subtext — the same
// split /play already makes, where the room hears the performance and the
// street outside only notices it. A shout in your own street is not scenery.
function shoutLine(text, distance, viaName) {
  if (distance === 0) return `You hear someone shout: ‡\n» ${text}`;

  const where = viaName ? ` from the direction of ${viaName}` : " somewhere nearby";

  const fraction = MUFFLE_BY_DISTANCE[distance];
  if (fraction == null) {
    return ambientLine(`You hear someone shout${where}, but you can't make out what they say.`);
  }
  return ambientLine(`You hear someone shout${where}:`, [muffle(text, fraction)]);
}

module.exports = { muffle, shoutLine, MUFFLE_BY_DISTANCE, BLOCKS };
