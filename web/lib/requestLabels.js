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
  REMOVE_TAG: "Remove Tag",
  CONSUME_TAG: "Consume Tag",
  TRANSFER_RESOURCES: "Transfer Resources",
  TRANSFER_TAG: "Transfer Tag",
  SET_MOOD: "Set Mood",
  DONATE_BLOOD: "Donate Blood",
  FEED_PERSON: "Feed Person",
  CHANGE_FEAR: "Change Fear",
  // Not "Fulfill Fear" — that reads like the player achieved
  // something, and every other label here is a thing they did.
  FULFILL_FEAR: "Fear Comes True",
  HEAL_CHARACTER: "Heal",
  CHANGE_NAME: "Change Name",
};

export const REQUEST_STATUS_LABELS = {
  PASSED: "Passed",
  EDITED: "Edited",
  UNDONE: "Undone",
};

// PASSED is the untouched default; either GM verdict means the request did not
// stand as the player made it.
export const REQUEST_STATUS_TONES = {
  PASSED: "neutral",
  EDITED: "bad",
  UNDONE: "bad",
};
