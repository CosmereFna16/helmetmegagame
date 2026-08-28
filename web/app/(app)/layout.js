import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import AppRail from "../components/AppRail";
import TurnChip from "../components/TurnChip";
import TurnChipAsync from "../components/TurnChipAsync";

// The nav item lists and loadNavItems moved to web/lib/navItems.js when (desk)
// grew a rail of its own — see the note at the top of that file.

export default async function AppLayout({ children }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // Not awaited here — passed down so Suspense can stream it in behind the
  // shell instead of blocking every navigation.
  const turnPromise = getOpenTurn();

  return (
    <div className="app-shell">
      <AppRail discordUserId={session.discordUserId} />
      <main className="app-main">{children}</main>
      <Suspense fallback={<TurnChip turn={null} />}>
        <TurnChipAsync turnPromise={turnPromise} />
      </Suspense>
    </div>
  );
}
