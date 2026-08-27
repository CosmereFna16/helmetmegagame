import RichText from "@/app/components/RichText";

// The transcript, rendered as something to read rather than a table.
//
// Two levels of grouping, both derived from CONSECUTIVE runs rather than by
// bucketing the whole page: entries arrive already ordered, so a turn header
// appears whenever the turn changes and a scene header whenever the
// location/thread changes. That keeps the reading order the query's order —
// bucketing would silently reorder a page whose sort is newest-first.
const KIND_LABELS = {
  TURN_START: "Turn",
  CHARACTER_CREATED: "Arrival",
  DEATH: "Death",
  DESIRE_FULFILLED: "Desire",
  LIFEWEB: "Lifeweb",
  TRAVEL: "Travel",
};

function turnLabel(entry) {
  if (entry.turnNumber == null) return "Before the game";
  const day = Math.ceil(entry.turnNumber / 2);
  const phase = entry.turnPhase ? `${entry.turnPhase.charAt(0)}${entry.turnPhase.slice(1).toLowerCase()}` : "";
  return `Day ${day}${phase ? ` — ${phase}` : ""}`;
}

function sceneLabel(entry) {
  const place = entry.zoneName ?? "Elsewhere";
  return entry.threadName ? `${place} · ${entry.threadName}` : place;
}

// A concealed message keeps both halves: the alias is what the room saw, the
// real name is who it was. Showing them together is what makes the finished
// archive readable as a whole story rather than a cast of strangers — and is
// also why archiveVisible is meant to stay off until the game ends.
function displayName(entry) {
  if (entry.concealedAlias) {
    return entry.characterName ? `${entry.concealedAlias} (${entry.characterName})` : entry.concealedAlias;
  }
  return entry.characterName ?? "Unknown";
}

function timeLabel(sentAt) {
  return new Date(sentAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SystemEntry({ entry }) {
  return (
    <li className="my-2 flex items-center gap-3 text-sm">
      <span className="h-px flex-1" style={{ background: "var(--border)" }} />
      <span className="chip shrink-0">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
      <span className="text-muted">{entry.content}</span>
      <span className="h-px flex-1" style={{ background: "var(--border)" }} />
    </li>
  );
}

function MessageEntry({ entry, avatarVersion }) {
  return (
    <li className="flex gap-3 py-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- the avatar route
          serves arbitrary uploaded bytes at an unknown intrinsic size; next/image
          would demand width/height it can't know and buys nothing here. */}
      <img
        src={
          entry.characterId
            ? `/api/avatar/${entry.characterId}${avatarVersion ? `?v=${avatarVersion}` : ""}`
            : "/assets/unknown.png"
        }
        alt=""
        width={36}
        height={36}
        className="mt-0.5 h-9 w-9 shrink-0 rounded object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <strong>{displayName(entry)}</strong>
          <span className="mono text-xs text-muted">{timeLabel(entry.sentAt)}</span>
        </div>
        {/* RichText, not ChipText: this is prose the reader can point at, and
            nothing here is a <button> or a tooltip, so an interactive TagChip
            is allowed — the same rule that puts RichText on documents and a
            character's appearance. pre-wrap because RP messages carry their
            own line breaks. */}
        <div className="text-sm" style={{ whiteSpace: "pre-wrap" }}>
          <RichText text={entry.content} />
        </div>
      </div>
    </li>
  );
}

export default function ArchiveFeed({ entries, avatarVersions }) {
  if (entries.length === 0) {
    return <p className="panel p-4 empty-state">Nothing recorded for these filters.</p>;
  }

  // Headers are decided in one pass BEFORE rendering rather than by tracking
  // the previous row inside .map() — reassigning a closure variable mid-render
  // is a react-hooks/immutability error in this repo, and this is clearer
  // anyway.
  const rows = [];
  let lastTurn;
  let lastScene;
  for (const entry of entries) {
    const turn = turnLabel(entry);
    const scene = entry.kind === "MESSAGE" ? sceneLabel(entry) : null;
    const showTurn = turn !== lastTurn;
    rows.push({
      entry,
      turn,
      scene,
      showTurn,
      showScene: scene !== null && (showTurn || scene !== lastScene),
    });
    lastTurn = turn;
    if (scene !== null) lastScene = scene;
  }

  return (
    <ul className="panel flex list-none flex-col p-4">
      {rows.map(({ entry, turn, scene, showTurn, showScene }) => (
        <div key={entry.id}>
          {showTurn && <h2 className="panel-header mt-4 first:mt-0">{turn}</h2>}
          {showScene && <p className="mt-3 text-xs uppercase tracking-wide text-muted">{scene}</p>}
          {entry.kind === "MESSAGE" ? (
            <MessageEntry entry={entry} avatarVersion={avatarVersions?.[entry.characterId]} />
          ) : (
            <SystemEntry entry={entry} />
          )}
        </div>
      ))}
    </ul>
  );
}
