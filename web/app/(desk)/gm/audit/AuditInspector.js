"use client";

import Link from "next/link";
import { useState } from "react";
import CharacterLink from "@/app/components/CharacterLink";
import StatusPill from "@/app/components/StatusPill";
import { describeAudit, prettifyActionType } from "@/lib/auditNarrative";
import AuditSegments from "./AuditSegments";

// The selected entry, in full.
//
// The point of this pane is that `details` stops being a JSON blob. Each key
// is rendered as a labelled fact, ids are resolved to names and linked to the
// thing they name, and the raw payload survives behind a disclosure for the
// times a GM genuinely needs to see the shape.

// Which route an id in `details` points at. Staging ids are deliberately
// absent: staged rows are consumed at the turn-end push, so a link to one is a
// link to nothing for every entry older than a day.
const LINKS = {
  // The literal URL, not TURNS_PATH — that constant is the route PATTERN for
  // revalidatePath and is not navigable.
  actionId: (v) => `/gm/turns/move/${v}`,
  requestId: (v) => `/gm/turns/request/${v}`,
  cavingRollId: (v) => `/gm/turns/caving/${v}`,
  characterId: (v) => `/gm/dev/characters/${v}`,
  tagId: () => "/gm/dev/tags",
  factionId: () => "/gm/dev/factions",
  discordUserId: (v) => `/gm/players/${v}`,
  targetDiscordUserId: (v) => `/gm/players/${v}`,
};

// "resourcesSpent" -> "Resources spent". The payload keys are camelCase
// because they are JavaScript, not because anyone chose them for reading.
function labelize(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export default function AuditInspector({ entry, names, onFilter }) {
  const [rawOpen, setRawOpen] = useState(false);
  const [copied, setCopied] = useState("");

  if (!entry) {
    return (
      <aside className="desk-inspector">
        <div className="desk-empty text-muted">
          <p>Pick a line to see who did it, to whom, and with what.</p>
          <p className="text-xs mt-2">
            <span className="mono">j</span> / <span className="mono">k</span> to walk,{" "}
            <span className="mono">Enter</span> to open.
          </p>
        </div>
      </aside>
    );
  }

  const { familyLabel, tone, segments } = describeAudit({ ...entry, names });
  const details = entry.details && typeof entry.details === "object" ? entry.details : null;
  const stamp = new Date(entry.createdAt);

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      // No timer to clear it: the next selection unmounts this pane, and a
      // stale "Copied" on a pane nobody is looking at costs nothing.
    } catch {
      setCopied("");
    }
  };

  return (
    <aside className="desk-inspector">
      <div className="desk-inspector-head">
        <div className="min-w-0">
          <h2 className="text-sm">{prettifyActionType(entry.actionType)}</h2>
          <p className="text-muted text-xs mono">{entry.actionType}</p>
        </div>
        <StatusPill tone={tone}>{familyLabel}</StatusPill>
      </div>

      <div className="desk-inspector-body">
        <div className="p-3 audit-sentence">
          <AuditSegments entry={entry} segments={segments} />
        </div>

        <dl className="desk-inspector-facts p-3">
          <Fact label="When">
            <span className="mono text-xs" title={stamp.toISOString()}>
              {stamp.toLocaleString()}
            </span>
          </Fact>
          <Fact label="Turn">
            {entry.turnNumber != null ? (
              <span className="mono">
                {entry.turnNumber}
                {entry.turnPhase ? ` · ${entry.turnPhase === "DAWN" ? "Dawn" : "Dusk"}` : ""}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </Fact>
        </dl>

        <section className="audit-person p-3">
          <h3 className="audit-group-title">Actor</h3>
          <div className="flex items-center gap-2">
            {/* A plain <img>: next.config.mjs declares no remotePatterns, so
                next/image against cdn.discordapp.com throws at render. Same
                reasoning as DiscordAvatar.js. */}
            {entry.actor.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="audit-avatar" src={entry.actor.avatarUrl} alt="" width={20} height={20} />
            )}
            <span>{entry.actor.name}</span>
            <span className="chip">{entry.actor.kind === "gm" ? "GM" : entry.actor.kind === "system" ? "System" : "Player"}</span>
          </div>
          {entry.actor.characterName && (
            <p className="text-xs mt-1">
              <CharacterLink characterId={entry.actor.characterId} name={entry.actor.characterName} isGm />
            </p>
          )}
          {entry.actor.kind !== "system" && (
            <button type="button" className="btn-quiet mt-1" onClick={() => onFilter({ actors: [entry.actor.discordUserId] })}>
              Everything by this actor
            </button>
          )}
        </section>

        {entry.target && (
          <section className="audit-person p-3">
            <h3 className="audit-group-title">Target</h3>
            <CharacterLink characterId={entry.target.id} name={entry.target.name} isGm />
            <button type="button" className="btn-quiet mt-1" onClick={() => onFilter({ targets: [entry.target.id] })}>
              Everything about this character
            </button>
          </section>
        )}

        {entry.reason && (
          <section className="audit-person p-3">
            <h3 className="audit-group-title">Reason</h3>
            {/* The player's own words — quoted content takes the » prefix
                everywhere in the app. */}
            <p className="audit-reason-block">» {entry.reason}</p>
          </section>
        )}

        {details && (
          <section className="audit-person p-3">
            <h3 className="audit-group-title">Details</h3>
            {/* gm_character_applied's `core` is already a before/after diff, so
                it gets rendered as one rather than flattened into two lines. */}
            {isDiff(details.core) ? <Diff diff={details.core} /> : null}
            <dl className="audit-details">
              {Object.entries(details)
                .filter(([key]) => !(key === "core" && isDiff(details.core)))
                .map(([key, value]) => (
                  <DetailRow key={key} name={key} value={value} names={names} />
                ))}
            </dl>
          </section>
        )}

        <section className="p-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => copy("link", `${window.location.origin}/gm/audit/${entry.id}`)}
          >
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
          {details && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => copy("json", JSON.stringify(details, null, 2))}
            >
              {copied === "json" ? "Copied" : "Copy JSON"}
            </button>
          )}
          {details && (
            <button type="button" className="btn-quiet" onClick={() => setRawOpen((v) => !v)}>
              {rawOpen ? "Hide raw" : "Raw"}
            </button>
          )}
        </section>

        {rawOpen && details && (
          <pre className="audit-raw mono">{JSON.stringify(details, null, 2)}</pre>
        )}
      </div>
    </aside>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DetailRow({ name, value, names }) {
  const href = typeof value === "string" && LINKS[name] ? LINKS[name](value) : null;
  const named = typeof value === "string" ? names?.[value] : null;

  return (
    <>
      <dt className="field-label">{labelize(name)}</dt>
      <dd>
        {href ? (
          <Link className="menu-item" href={href}>
            {named ?? shortId(value)}
          </Link>
        ) : named ? (
          <span>{named}</span>
        ) : (
          <Value value={value} names={names} />
        )}
      </dd>
    </>
  );
}

function Value({ value, names }) {
  if (value == null) return <span className="text-muted">—</span>;
  if (typeof value === "boolean") return <span>{value ? "yes" : "no"}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted">none</span>;
    // A list of ids resolves to a list of names; anything else prints as it is.
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span className="chip" key={i}>
            {(typeof v === "string" && names?.[v]) || (typeof v === "object" ? JSON.stringify(v) : String(v))}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === "object") {
    return <pre className="audit-raw mono">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span className={typeof value === "number" ? "mono" : undefined}>{String(value)}</span>;
}

// The dev panel's diff shape: { field: { from, to } }.
function isDiff(v) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => x && typeof x === "object" && ("from" in x || "to" in x))
  );
}

function Diff({ diff }) {
  return (
    <table className="data-table audit-diff">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Was</th>
          <th scope="col">Now</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(diff).map(([field, change]) => (
          <tr key={field}>
            <td>{labelize(field)}</td>
            <td className="text-muted">{format(change.from)}</td>
            <td>{format(change.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function format(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// A cuid in a fact table is unreadable and unmemorable; the last six
// characters are enough to tell two rows apart, and the raw payload has the
// whole thing.
function shortId(v) {
  return v.length > 12 ? `…${v.slice(-6)}` : v;
}
