export const APPEARANCE_MAX_LENGTH = 300;

// Lives here rather than in lib/requests.js because RequestDialog is a client
// component: importing it from requests.js drags @lifeweb/db (and node:fs)
// into the browser bundle. Same reason lib/formatTagRequirement.js exists.
export const MAX_REASON_LENGTH = 500;

// Every GM-authored message that actually reaches Discord: a staged private
// message or public declaration on /gm/turns, the broadcast composer, the
// per-row composer, the /gm/messages reply, and the Dev Panel's message modal.
//
// One Discord message is 2000 characters. Everything above splits across
// several rather than failing — DMs through sendDm/postDmBatched, public
// declarations through postMessageBatched — all of it via chunkMessage
// (db/lib/chunkText.js), which breaks on blank lines. So this number is not
// Discord's limit; it is how much prose a GM may stage in one row before they
// should be splitting it themselves. 6000 is about three messages.
//
// It is NOT a truncation point. The composers show the count and refuse to
// stage over it, so a long paste is visible and trimmable rather than silently
// cut — which is exactly the bug the old client-side maxLength caused.
export const GM_MESSAGE_MAX_LENGTH = 6000;

// The Move Result box (Action.resultMessage) — GM-facing canon that is never
// sent to Discord, so it has no business sharing a Discord-shaped cap. Bounded
// only against a runaway paste; the column itself is unbounded.
export const RESULT_BOX_MAX_LENGTH = 12000;

// A player's private Journal entry (/notes) — generous, since it's a personal
// record rather than something read aloud, but capped so a runaway paste
// can't bloat a single row indefinitely.
export const JOURNAL_TITLE_MAX_LENGTH = 120;
export const JOURNAL_BODY_MAX_LENGTH = 8000;
export const JOURNAL_LABEL_MAX_LENGTH = 24;
export const JOURNAL_MAX_LABELS = 8;
