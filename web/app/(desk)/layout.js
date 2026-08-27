import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";

// The full-viewport route group. Pages in here get the raw viewport — no
// NavRail, no .app-shell, no TurnChip — because they are workspaces that own
// their whole screen (DESIGN-SYSTEM.md's sanctioned deviation; today that is
// exactly one page, the /gm/turns adjudication workspace). The URL space is
// shared with (app): a path may be defined in one group or the other, never
// both.
//
// Gated GM-only at the layout so nothing in here needs to repeat the
// redirect dance; pages still re-check inside their server actions, since a
// layout gate is presentation and an action gate is enforcement.
export default async function DeskLayout({ children }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { isGm } = await getGmSession();
  if (!isGm) redirect("/character");

  return children;
}
