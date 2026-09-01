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
// ONE EXCEPTION, and it proves the rule: a Bird's letter is signed. Every other
// caller here describes something done TO a helpless person, where the identity
// is the thing being withheld. A letter nobody can attribute is not a letter —
// the whole act is choosing to tell someone who you are. See BIRD.md.
//
// No-ops on a character with no discordUserId (shouldn't happen for a live
// party, but callers pass whatever resolveParty/findFirst gave them).
export function notifyCharacter(character, text, opts = {}) {
  if (!character?.discordUserId) return;
  after(() =>
    sendDm(character.discordUserId, text, {
      authorDiscordUserId: opts.authorDiscordUserId ?? null,
      source: opts.source ?? "player_event",
      // Forwarded rather than dropped: a Bird's letter carries a Reply button,
      // and carries its own plaintext in meta so /gm/messages can join a wall
      // of runes back to what it actually says.
      components: opts.components,
      meta: opts.meta,
    }).catch((err) => console.error(`notifyCharacter DM failed for ${character.id}:`, err)),
  );
}
