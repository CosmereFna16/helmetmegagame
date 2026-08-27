export const APPEARANCE_MAX_LENGTH = 300;

// Lives here rather than in lib/requests.js because RequestDialog is a client
// component: importing it from requests.js drags @lifeweb/db (and node:fs)
// into the browser bundle. Same reason lib/formatTagRequirement.js exists.
export const MAX_REASON_LENGTH = 500;

// A fulfilled Fear always costs exactly this many Tag Points — never a
// 1-5 ladder like a Desire, and never GM-re-scorable. Lives here rather than
// in requestActions.js (a "use server" module may only export async
// functions) or lib/requests.js (FearPanel and the creation wizard are
// client components, and that file pulls in @lifeweb/db) — same reasoning as
// MAX_REASON_LENGTH above.
export const FEAR_PENALTY = 3;

// Same cap as Desire.text.
export const FEAR_MAX_LENGTH = 300;

// Every GM-authored message that ends up in a Discord DM: the Move Result box,
// the broadcast composer, the per-row composer, the /gm/messages reply, and
// the Dev Panel's message modal.
//
// One Discord message is 2000 characters, and sendDm prepends "» ", so 1990
// leaves headroom. sendDm chunks anything longer rather than dropping it, but
// a GM should still know where the edge is — before this, the boxes had no
// limit at all, the send failed, and .catch(() => null) reported the Move
// solved with the player never told.
export const GM_MESSAGE_MAX_LENGTH = 1990;
