// The Request enums as prose, with no Prisma import — the whole point.
//
// These lived in web/lib/requests.js, which imports the @lifeweb/db barrel and
// therefore constructs a PrismaClient. That is fine for the server actions that
// live there, but it means no client component could reach the labels without
// dragging Prisma into the browser bundle, so the Dev Panel's Record tab
// rendered raw enums instead. Same split, same reason, as web/lib/moves.js.
//
// requests.js re-exports both so every existing server-side import keeps
// working unchanged.

export const REQUEST_TYPE_LABELS = {
  FULFILL_DESIRE: "Fulfill Desire",
  ADD_TAG: "Add Tag",
  BUY_TAGS: "Store Purchase",
  REMOVE_TAG: "Remove Tag",
  CONSUME_TAG: "Consume Tag",
  TRANSFER_RESOURCES: "Transfer Resources",
  TRANSFER_TAG: "Transfer Tag",
  DONATE_BLOOD: "Donate Blood",
  FEED_PERSON: "Feed Person",
  HEAL_CHARACTER: "Heal",
  CHANGE_NAME: "Change Name",
  CAVING_LOOT: "Caving Find",
  LOOT_CHARACTER: "Loot Character",
  MOVE_CHARACTER: "Move Character",
  BIND_CHARACTER: "Bind Character",
  FREE_CHARACTER: "Free Character",
  HARM_CHARACTER: "Harm Character",
  BURY_CHARACTER: "Bury Person",
  FAST_TRAVEL: "Fast Travel",
  // Retired: Create Item and the zone cache are gone, and nothing writes
  // these any more. The labels stay because the enum values do — Postgres
  // cannot drop a value in place — so a row filed before the removal still
  // reads as prose instead of a raw enum on /gm/turns and /gm/audit. There is
  // no REQUEST_EFFECTS entry and no RequestSections body behind them, so such
  // a row shows its label and nothing else, which is the intended outcome.
  CREATE_TAG: "Create Item",
  DROP_ITEM: "Drop Item",
  PICK_UP_ITEM: "Pick Up Item",
};

export const REQUEST_STATUS_LABELS = {
  PASSED: "Passed",
  EDITED: "Edited",
  UNDONE: "Undone",
};

// PASSED is the untouched default. EDITED is routine bookkeeping — a GM
// tweak, not a problem — so it reads neutral too. Only UNDONE, a reversal,
// gets the warning tone.
export const REQUEST_STATUS_TONES = {
  PASSED: "neutral",
  EDITED: "neutral",
  UNDONE: "bad",
};
