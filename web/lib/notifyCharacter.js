import { after } from "next/server";
import { sendDm } from "@/lib/discordGuild";

// One line to a player about something that happened TO their character.
// Fired from after(), post-commit: a DM must never hold up the action that
// triggered it, and a failed DM must never undo what already happened.
//
// Deliberately unattributed — callers write what CHANGED, never who did it,
// since naming the actor would tell a helpless victim something the fiction
// doesn't (REQUESTS.md). Exception: a Bird's letter is signed (BIRD.md).
//
// No-ops on a character with no discordUserId.
export function notifyCharacter(character, text, opts = {}) {
  if (!character?.discordUserId) return;
  after(() =>
    sendDm(character.discordUserId, text, {
      authorDiscordUserId: opts.authorDiscordUserId ?? null,
      source: opts.source ?? "player_event",
      // Forwarded rather than dropped: a Bird's letter carries a Reply button,
      // and names the paper it delivered in meta so /gm/messages can join the
      // DM to the object that moved.
      components: opts.components,
      meta: opts.meta,
    }).catch((err) => console.error(`notifyCharacter DM failed for ${character.id}:`, err)),
  );
}
