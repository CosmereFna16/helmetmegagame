"use server";

import { getGmSession } from "@/lib/discordGuild";
import { loadDevPanelProps, loadDevPanelRecord } from "@/lib/devPanelData";
import { prisma } from "@lifeweb/db";
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

// Loads the same open-the-panel DTO bundle the standalone Dev Panel page
// renders, for the modal to spread onto <DevPanel frame="modal" .../>. The
// Record tab's history is NOT in it — see getDevPanelRecord below.
export async function getDevPanelData(input) {
  return guarded(async () => {
    const session = await requireGm();
    const props = await loadDevPanelProps(input?.characterId, session.discordUserId);
    if (!props) throw new UserError("Character not found.");
    return { props };
  });
}

// The Record tab's four history lists, fetched on the first click of that tab
// rather than at open. Used by BOTH frames — the standalone page defers it the
// same way the modal does, so the page's RSC no longer carries 350 rows a GM
// usually never looks at.
//
// discordUserId is resolved from the character row here, not taken from the
// client: a server action is a public endpoint, and this one reads a person's
// whole DM history.
export async function getDevPanelRecord(input) {
  return guarded(async () => {
    await requireGm();
    if (!input?.characterId) throw new UserError("Character not found.");
    const character = await prisma.character.findUnique({
      where: { id: input.characterId },
      select: { id: true, discordUserId: true },
    });
    if (!character) throw new UserError("Character not found.");
    return { record: await loadDevPanelRecord(character.id, character.discordUserId) };
  });
}
