export const APPEARANCE_MAX_LENGTH = 100;

// Lives here rather than in lib/requests.js because RequestDialog is a client
// component: importing it from requests.js drags @lifeweb/db (and node:fs)
// into the browser bundle. Same reason lib/formatTagRequirement.js exists.
export const MAX_REASON_LENGTH = 500;
