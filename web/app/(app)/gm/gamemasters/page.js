import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { listGmMembers } from "@/lib/discordGuild";
import { listGmAssignments } from "@/lib/gmZone";
import { sortZones } from "@/lib/zones";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import CharacterLink from "@/app/components/CharacterLink";
import DiscordAvatar from "@/app/components/DiscordAvatar";
import GmZonePicker from "./GmZonePicker";

// The GM roster and their zone seats. Superadmin only — this is the one page
// that shows Discord identities rather than characters, and the seats it sets
// decide what every other GM table opens on.
export default async function GamemastersPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/gm/players");

  const [members, zones, assignments] = await Promise.all([
    listGmMembers(),
    // SEAT zones only — Town, Fortress, Windlands, Caves. The three cave
    // levels are excluded because nothing is ever stamped with one
    // (db/lib/seatZone.js maps them all to the Caves group), so a GM seated on
    // the Railroad would open every table on an empty filter. This used to be
    // a bare findMany, which is exactly the bug it produced.
    prisma.zone.findMany({ where: { kind: { not: "CAVE_LEVEL" } }, select: { id: true, name: true } }),
    listGmAssignments(),
  ]);

  // GMs play too, so most of them have a character — but not all, which is
  // exactly why the seat is keyed on discordUserId rather than hung off
  // Character.
  const characters = await prisma.character.findMany({
    where: { discordUserId: { in: members.map((m) => m.id) }, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true },
  });
  const characterByUserId = new Map(characters.map((c) => [c.discordUserId, c]));

  // Fortress → Town → Windlands → Caves, matching the map and roles.yaml,
  // rather than alphabetical.
  const ordered = sortZones(zones);
  const roster = [...members].sort((a, b) =>
    (a.globalName ?? a.username).localeCompare(b.globalName ?? b.username),
  );

  return (
    <PageShell>
      <PageHeader
        title="Gamemasters"
        subtitle="Superadmin only. A zone seat is a soft default — it decides which zones a GM's tables open on, and hides nothing. A GM may hold several."
        actions={
          <nav className="flex gap-4 text-sm">
            <Link href="/gm/audit" className="menu-item">
              Audit
            </Link>
            <Link href="/gm/dev" className="menu-item">
              Dev
            </Link>
          </nav>
        }
      />

      <section className="panel table-scroll">
        <table className="data-table" style={{ minWidth: "760px" }}>
          <thead>
            <tr>
              <th scope="col">Gamemaster</th>
              <th scope="col">Character</th>
              <th scope="col">Zone seats</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => {
              const character = characterByUserId.get(m.id);
              return (
                <tr key={m.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <DiscordAvatar
                        discordUserId={m.id}
                        avatar={m.avatar}
                        name={m.globalName ?? m.username}
                      />
                      <span>
                        {m.globalName ?? m.username}
                        {m.globalName && (
                          <span className="block text-xs text-muted mono">@{m.username}</span>
                        )}
                      </span>
                      {isSuperadmin(m.id) && <span className="chip">Master</span>}
                    </span>
                  </td>
                  <td>
                    <CharacterLink characterId={character?.id} name={character?.name} isGm />
                  </td>
                  <td>
                    <GmZonePicker
                      discordUserId={m.id}
                      zones={ordered}
                      currentZoneIds={(assignments.get(m.id) ?? []).map((z) => z.id)}
                    />
                  </td>
                </tr>
              );
            })}
            {roster.length === 0 && (
              <tr>
                <td colSpan={3} className="text-muted">
                  Nobody holds the GM role — check DISCORD_GM_ROLE_ID.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </PageShell>
  );
}
