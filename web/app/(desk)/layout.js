import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import AppRail from "../components/AppRail";
import { GM_NAV } from "@/lib/navItems";

// The full-viewport route group: pages here own their whole screen, no
// PageShell/centred max-width, because they're workspaces (DESIGN-SYSTEM.md's
// sanctioned deviation). They get the nav rail, but no TurnChip — it's fixed
// bottom-right and would land on the adjudication desk's staging tray; both
// desks show the turn in their own header instead.
//
// The URL space is shared with (app): a path lives in one group or the
// other, never both. Gated GM-only here so pages don't repeat the redirect;
// actions still re-check the gate themselves — a layout gate is presentation.
export default async function DeskLayout({ children }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { isGm } = await getGmSession();
  if (!isGm) redirect("/character");

  return (
    <div className="app-shell">
      <AppRail discordUserId={session.discordUserId} fallback={GM_NAV} />
      <main className="app-main">{children}</main>
    </div>
  );
}
