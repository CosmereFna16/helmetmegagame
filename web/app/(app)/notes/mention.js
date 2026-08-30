// The @ autocomplete's pure logic, split out of JournalComposer.js so it has
// no React dependency and no "use client" — plain functions are easier to
// reason about than component state, and every mention-autocomplete bug we
// looked at when designing this traces back to something that should have
// been derived (from `value` + `caret`) instead being stored and drifting out
// of sync. There is nothing stored here at all.

export const MAX_QUERY = 32;

// The active "@query" ending at the caret, or null. Walks back from the
// caret to the nearest '@', stopping dead at any whitespace — a mention
// query never spans a space or a newline, which is what makes "cancel on
// space" free rather than a second rule that could disagree with this one.
export function findMentionQuery(text, caret) {
  if (typeof caret !== "number") return null;
  const upto = text.slice(0, caret);
  let i = upto.length - 1;
  while (i >= 0 && !/[\s@]/.test(upto[i])) i -= 1;
  if (i < 0 || upto[i] !== "@") return null;
  // '@' must START a word: begin-of-text, or after whitespace/an opener.
  // Blocks "name@example.com" and "@@".
  const before = i > 0 ? upto[i - 1] : "";
  if (before && !/[\s([{"'‘“]/.test(before)) return null;
  const query = upto.slice(i + 1);
  if (query.length > MAX_QUERY) return null;
  return { start: i, end: caret, query };
}

// Prefix-on-any-word first, then substring, alphabetical after that.
// Deterministic and dependency-free rather than routing through the shared
// fuzzy scorer — this list is at most a few hundred rows and a plain rank is
// plenty legible.
export function rankRoster(roster, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return roster.slice(0, limit);
  const hits = [];
  for (const c of roster) {
    const name = c.name.toLowerCase();
    const rank = name.startsWith(q) ? 0 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : 3;
    if (rank < 3) hits.push({ c, rank });
  }
  // Sort a copy, never the caller's array — react-hooks/immutability is an
  // error in this repo, and `roster` is a prop.
  return hits
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((h) => h.c);
}

// Splices `{char:<id>} ` into `text` at the query's byte range, and reports
// where the caret should land afterward. The trailing space is what closes
// the query — without it, accepting a mention would leave the caret still
// inside what findMentionQuery sees as an (empty) @-run, and typing the next
// word would immediately reopen the menu.
export function insertMention(text, query, character) {
  const token = `{char:${character.id}} `;
  const next = text.slice(0, query.start) + token + text.slice(query.end);
  return { text: next, caret: query.start + token.length };
}
