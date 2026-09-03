// Long prose the old /gm/dev switch labels and footnotes used to carry
// inline. The redesigned page (web/app/(desk)/gm/dev/page.js) shortens every
// toggle to a one-line label and moves the detail here, read through
// InfoIcon. Every sentence that used to sit on a Switch's children or in a
// footnote paragraph is preserved here, word for word — only JSX markup
// (<strong>, HTML entities used for JSX-safe quoting) is dropped.
export const CONFIG_HELP = {
  leaderWhitelistEnabled: "Require the @Leader Whitelist role to pick a Leader (★) role.",
  playtestModeEnabled:
    "Lock the Merchant and every Windlands role out of character creation. Their cards still show, greyed, so the charters stay readable. Not bypassed for superadmins.",
  autoTurnAdvanceDisabled:
    "The twice-daily cron skips its advance while this is on. “Advance turn now” on the Turn section still works.",
  avatarUploadsEnabled: "Allow players to upload their own profile picture.",
  portraitMakerEnabled: "Show the “Customize Appearance” portrait maker on /character.",
  portraitFantasyPartsEnabled: "Allow the portrait maker's fantasy parts.",
  messageWipeEnabled:
    "The transcript is already recorded at send time, this only deletes (see docs/systemdocs/CHANNELS.md).",
  catatonicEnabled:
    "Idle turns before a character goes Catatonic (AFK). Flags a character Catatonic (AFK) after that many turns with no move filed and nothing said in character — clears the moment they act or speak again.",
  catatonicDeathTurns:
    "The one automatic death in the game: a character who stays Catatonic this many turns straight dies at turn close — full cleanup, no GM confirm. Covers AFK players and players who left the server (their characters go Catatonic on the spot instead of dying). 0 turns it off; the player gets a warning DM one turn before.",
  locationMoveCooldownSeconds:
    "How long a character waits between two walks from one location to another inside the same zone. Crossing into another zone is gated by the Move instead, so this never touches it. 0 removes the wait. ‡",
  autoReconcileEnabled:
    "Run the channel doctor's cheap reconcile (roles vs. the database) automatically after every turn advance — it always runs when the bot restarts.",
  tupperAutocorrectEnabled: "Capitalize sentence starts in Tupper messages before proxying.",
  nicknameSyncEnabled:
    "Sync Discord nicknames to “{base} | Character Name” on profile/character changes.",
  archiveVisible:
    "Effectively one-way: shows every location regardless of where a character stood, and names the character behind every /conceal. Meant for after the game ends.",
  archiveTravelEvents: "Record arrivals/departures in the archive.",
  lifewebBlood: "0-100, raw override.",
  desiresEnabled:
    "Let players claim Desires on /character. Turning this off shows “Temporarily disabled.” in place of the Desire panel and blocks a claim server-side. GMs can still award one — catalog or free text — from a character's Dev Panel regardless.",
  desireSlots:
    "How many Desire slots every character gets. Each slot cools down independently of the others, and the bottom one is the slot an Addiction binds. Lowering this hides a slot rather than deleting what was claimed in it.",
  desireSlotLockTurns:
    "Whole turns a slot stays shut after a Desire is claimed into it. At 2, a claim on turn 40 leaves that slot shut through turn 42 and open on 43. Remember a turn is half a day.",
  carryWeightLbs:
    "How many POUNDS of gear a character can carry before they're Overburdened. Skills, injuries and Assets — a horse, a cart, a house — never weigh anything. Strong, Pack Mule and an equipped Cart multiply it. Past 1.5× this, goods can't be theirs at all. ‡",
  carryResourceCap:
    "How many ⬢ a character can carry before they're Overburdened. Income still lands; they just lose their free zone move until they stash some. Strong, Pack Mule and an equipped Cart multiply it. ‡",
  freeZoneMovesPerTurn:
    "Zone crossings a character gets each turn before crossing starts spending their Move. An equipped mount adds 1 on top; being Overburdened takes them all away. ‡",
};
