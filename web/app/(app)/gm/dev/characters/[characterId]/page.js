import { redirect, notFound } from "next/navigation";
import { getGmSession } from "@/lib/discordGuild";
import { loadDevPanelProps } from "@/lib/devPanelData";
import PageShell from "@/app/components/PageShell";
import DevPanel from "./DevPanel";

// The GM's one-stop character editor. Gated on GM membership rather than
// superadmin, because it is where every CharacterLink in the app points and
// an in-game GM is meant to use it — only the Delete microaction narrows to
// superadmin, and it does that in the action itself.
//
// The data assembly lives in web/lib/devPanelData.js, shared with the modal
// mount over /gm/turns (web/app/(desk)/gm/turns/devPanelActions.js) — this
// page is just the auth gate and the shell around <DevPanel/>.
export default async function DevCharacterPanelPage({ params }) {
  const { characterId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const props = await loadDevPanelProps(characterId, session.discordUserId);
  if (!props) notFound();

  return (
    <PageShell width="wide">
      <DevPanel {...props} />
    </PageShell>
  );
}
