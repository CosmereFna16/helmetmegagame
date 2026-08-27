export const APPEARANCE_MAX_LENGTH = 300;

// Lives here rather than in lib/requests.js because RequestDialog is a client
// component: importing it from requests.js drags @lifeweb/db (and node:fs)
// into the browser bundle. Same reason lib/formatTagRequirement.js exists.
export const MAX_REASON_LENGTH = 500;

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
