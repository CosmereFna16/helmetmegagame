export const APPEARANCE_MAX_LENGTH = 100;

// Lives here rather than in lib/requests.js because RequestDialog is a client
// component: importing it from requests.js drags @lifeweb/db (and node:fs)
// into the browser bundle. Same reason lib/formatTagRequirement.js exists.
export const MAX_REASON_LENGTH = 500;

// A fulfilled Worst Fear always costs exactly this many Tag Points — never a
// 1-5 ladder like a Desire, and never GM-re-scorable. Lives here rather than
// in requestActions.js (a "use server" module may only export async
// functions) or lib/requests.js (WorstFearPanel and the creation wizard are
// client components, and that file pulls in @lifeweb/db) — same reasoning as
// MAX_REASON_LENGTH above.
export const WORST_FEAR_PENALTY = 3;

// Same cap as Desire.text.
export const WORST_FEAR_MAX_LENGTH = 300;
