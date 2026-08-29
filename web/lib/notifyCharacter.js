import { after } from "next/server";
import { sendDm } from "@/lib/discordGuild";

// One line to a player about something that happened TO their character.
// Fired from after(), post-commit: a DM must never hold up the action that
// triggered it, and a failed DM must never undo what already happened.
//
// Deliberately unattributed. Every caller writes what CHANGED, never who did
// it — a bind or a looting only lands on a helpless target, and naming the
// actor would tell the victim something the fiction doesn't. See
// REQUESTS.md for the rule this enforces.
//
// No-ops on a character with no discordUserId (shouldn't happen for a live
// party, but callers pass whatever resolveParty/findFirst gave them).
export function notifyCharacter(character, text, opts = {}) {
  if (!character?.discordUserId) return;
  after(() =>
    sendDm(character.discordUserId, text, {
      authorDiscordUserId: opts.authorDiscordUserId ?? null,
      source: opts.source ?? "player_event",
    }).catch((err) => console.error(`notifyCharacter DM failed for ${character.id}:`, err)),
  );
}
