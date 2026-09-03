// The house format for a line the WORLD says into a channel — a gate crossing
// into a zone's #summary, a smell in a Location, a whisper overheard in a
// Room, somebody moving goods around a stash, the intercom.
//
// It is Discord's `-#` subtext, and the reason is that these lines are
// scenery. They arrive unprompted, often while people are mid-scene, and
// full-size bot text competing with player prose is what made them read as
// interruptions. Subtext sits under the conversation instead of in it.
//
// Before this existed the five call sites had four different formats between
// them — `»`, `*italics*`, bare text, and one that had lost its ‡ entirely.
// Anything new that narrates into a channel comes through here.
//
// Two mechanical rules, both easy to get wrong by hand:
//   - `-#` is PER LINE. A multi-line block needs the prefix on every line, or
//     everything after the first renders full size.
//   - One ‡ per message, at the very end — not one per line (CLAUDE.md).

// `text` is the line itself; `lines` are quoted extras under it, which take a
// `»` inside the subtext the way any restated content does.
function ambientLine(text, lines = []) {
  const body = [`-# ${text}`, ...lines.map((l) => `-# » ${l}`)];
  return `${body.join("\n")} ‡`;
}

module.exports = { ambientLine };
