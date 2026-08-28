"use server";

import { getGmSession } from "@/lib/discordGuild";
import { loadDevPanelProps } from "@/lib/devPanelData";
import { UserError, guarded } from "@/lib/actionResult";

// The server half of the Dev Panel modal (DevPanelModal.js), shared by every
// desk that mounts it — /gm/turns and /gm/players. This is its own
// "use server" file rather than an import from one desk's actions.js,
// because those are themselves "use server" modules — their requireGm isn't
// importable, so the same few lines are replicated here.
async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

// Loads the same 24-prop DTO bundle the standalone Dev Panel page renders,
// for the modal to spread onto <DevPanel frame="modal" .../>.
export async function getDevPanelData(input) {
  return guarded(async () => {
    const session = await requireGm();
    const props = await loadDevPanelProps(input?.characterId, session.discordUserId);
    if (!props) throw new UserError("Character not found.");
    return { props };
  });
}
