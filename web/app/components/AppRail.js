import { Suspense } from "react";
import NavRail from "./NavRail";
import NavRailAsync from "./NavRailAsync";
import { PLAYER_NAV, loadNavItems } from "@/lib/navItems";

// The rail both route groups render, so neither hand-rolls the Suspense
// wiring. The items promise is created here and deliberately NOT awaited —
// NavRailAsync reads it with use() inside the boundary, so the shell paints
// before the Discord role check and the Mortus-tag lookup land.
//
// `fallback` is what shows during that stream. (desk) passes GM_NAV, because
// it is GM-gated at the layout and a PLAYER_NAV flash there would be wrong.
export default function AppRail({ discordUserId, fallback = PLAYER_NAV }) {
  return (
    <Suspense fallback={<NavRail items={fallback} />}>
      <NavRailAsync itemsPromise={loadNavItems(discordUserId)} />
    </Suspense>
  );
}
