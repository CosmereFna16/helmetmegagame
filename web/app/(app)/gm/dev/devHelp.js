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
    "Let players set new Desires on /character. Turning this off greys the form and shows “Temporary disabled.” A Desire already ACTIVE can still be fulfilled or cancelled, and GMs can still set one from a character's Dev Panel.",
};
