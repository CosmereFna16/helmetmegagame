import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import AppRail from "../components/AppRail";
import { GM_NAV } from "@/lib/navItems";

// The full-viewport route group: pages in here own their whole screen, with no
// PageShell and no centred max-width, because they are workspaces rather than
// documents (DESIGN-SYSTEM.md's sanctioned deviation).
//
// They do get the nav rail. They used to render bare, which made the desk a
// place you could only leave through one hand-placed "Exit" link — and with a
// second desk arriving beside /gm/turns, the way between them cannot be a link
// each one remembers to carry. So the desk renders the same .app-shell as
// (app), and a desk page is full-viewport-minus-rail.
//
// No TurnChip, though: it is fixed to the bottom-right corner and would land
// on top of the adjudication desk's staging tray. Both desks show the turn in
// their own header instead.
//
// The URL space is shared with (app): a path may be defined in one group or
// the other, never both — two groups resolving to one URL is a build error.
//
// Gated GM-only at the layout so nothing in here needs to repeat the redirect
// dance; pages still re-check inside their server actions, since a layout gate
// is presentation and an action gate is enforcement.
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
