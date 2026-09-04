import { statusWord } from "@lifeweb/db/lib/structures";

// What stands at the character's Location — a finished wall, a half-built
// palisade, a ruin (db/lib/structures.js). Read-only: the working half is the
// Craft dialog, which is where a site is joined or called off.
//
// A server component, so `statusWord` comes off the shared module rather than
// a copy — the sheet and the Location's own ambient lines have to agree about
// what "half-built" means. Rendered by StatusPanel as its sibling, and only
// when something is here: an empty panel saying nothing stands here is noise
// on every Location in the game.

export default function StandingHerePanel({ sites = [] }) {
  if (!sites.length) return null;

  return (
    <section className="panel p-4">
      <h2 className="panel-header">Standing here ‡</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {sites.map((s) => (
          <li key={s.id}>
            {s.typeName} — <span className="text-muted">{statusWord(s.status)}</span>
            {s.status === "UNDER_CONSTRUCTION" ? (
              <span className="mono text-muted">
                {" "}
                ({s.turnsDone}/{s.turnsNeeded})
              </span>
            ) : null}{" "}
            ‡
          </li>
        ))}
      </ul>
    </section>
  );
}
