"use client";

import { useMemo, useState } from "react";
// Everything here comes from auditNarrative, never from auditQuery: that one
// imports Prisma, and a client component reaching for one constant in it drags
// the whole data layer into the browser bundle.
import { AUDIT_FAMILIES, DATE_PRESETS, prettifyActionType } from "@/lib/auditNarrative";

// The filter rail. Every control writes into the URL through the `set` the
// desk passes down — nothing here holds filter state of its own, because the
// URL is the state and a filtered view has to survive being pasted at another
// GM.
//
// The one exception is `search`, which is typed: it is held locally so the
// input does not lose a keystroke to a round trip, and committed on Enter or
// blur.

const ACTOR_KINDS = [
  ["", "Anyone"],
  ["gm", "GMs"],
  ["player", "Players"],
  ["system", "System"],
];

export default function AuditFilters({
  filters,
  set,
  typeCounts,
  actors,
  characters,
  factions,
  zones,
  turnNumbers,
}) {
  const [search, setSearch] = useState(filters.q);
  const [typeQuery, setTypeQuery] = useState("");
  const [actorQuery, setActorQuery] = useState("");

  const toggle = (key, value) => {
    const current = filters[key];
    set({ [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };

  const visibleTypes = useMemo(() => {
    const q = typeQuery.trim().toLowerCase();
    // Selected types stay pinned to the top even when the search would hide
    // them, so a filter can always be taken back off.
    const selected = typeCounts.filter((t) => filters.types.includes(t.actionType));
    const rest = typeCounts.filter(
      (t) => !filters.types.includes(t.actionType) && (!q || t.actionType.includes(q)),
    );
    return [...selected, ...rest].slice(0, 40);
  }, [typeCounts, typeQuery, filters.types]);

  const visibleActors = useMemo(() => {
    const q = actorQuery.trim().toLowerCase();
    const selected = actors.filter((a) => filters.actors.includes(a.id));
    const rest = actors.filter(
      (a) => !filters.actors.includes(a.id) && (!q || a.name.toLowerCase().includes(q)),
    );
    return [...selected, ...rest].slice(0, 30);
  }, [actors, actorQuery, filters.actors]);

  const active =
    filters.q ||
    filters.families.length ||
    filters.types.length ||
    filters.actors.length ||
    filters.actorKind ||
    filters.targets.length ||
    filters.factions.length ||
    filters.zones.length ||
    filters.turnFrom ||
    filters.turnTo ||
    filters.preset ||
    filters.from ||
    filters.to;

  return (
    <div className="audit-filters">
      <label className="field">
        <span className="field-label">Search</span>
        <input
          value={search}
          placeholder="name, reason, anything in the details…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && set({ q: search })}
          onBlur={() => search !== filters.q && set({ q: search })}
        />
      </label>

      <Group label="Family">
        <div className="audit-chips">
          {Object.entries(AUDIT_FAMILIES).map(([key, fam]) => (
            <button
              key={key}
              type="button"
              className="chip"
              data-active={filters.families.includes(key) || undefined}
              aria-pressed={filters.families.includes(key)}
              onClick={() => toggle("families", key)}
            >
              {fam.label}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Who">
        <div className="segmented" role="group" aria-label="Actor kind">
          {ACTOR_KINDS.map(([value, label]) => (
            <button
              key={value || "any"}
              type="button"
              aria-pressed={filters.actorKind === value}
              onClick={() => set({ actorKind: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="control mt-2"
          value={actorQuery}
          placeholder="Find a person…"
          onChange={(e) => setActorQuery(e.target.value)}
          aria-label="Find an actor"
        />
        <div className="audit-picker">
          {visibleActors.map((a) => (
            <button
              key={a.id}
              type="button"
              className="audit-picker-row"
              data-active={filters.actors.includes(a.id) || undefined}
              aria-pressed={filters.actors.includes(a.id)}
              onClick={() => toggle("actors", a.id)}
            >
              <span className="audit-picker-name">{a.name}</span>
              <span className="text-muted text-xs">{a.kind === "gm" ? "GM" : ""}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group label="Action type">
        <input
          className="control"
          value={typeQuery}
          placeholder="Filter the list…"
          onChange={(e) => setTypeQuery(e.target.value)}
          aria-label="Filter action types"
        />
        <div className="audit-picker">
          {visibleTypes.map((t) => (
            <button
              key={t.actionType}
              type="button"
              className="audit-picker-row"
              data-active={filters.types.includes(t.actionType) || undefined}
              aria-pressed={filters.types.includes(t.actionType)}
              onClick={() => toggle("types", t.actionType)}
              title={t.actionType}
            >
              <span className="audit-picker-name">{prettifyActionType(t.actionType)}</span>
              <span className="text-muted text-xs mono">{t.count}</span>
            </button>
          ))}
          {visibleTypes.length === 0 && <p className="text-muted text-xs p-2">Nothing matches.</p>}
        </div>
      </Group>

      <Group label="About">
        <label className="field">
          <span className="field-label">Character</span>
          <select
            value={filters.targets[0] ?? ""}
            onChange={(e) => set({ targets: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Anyone</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status !== "ALIVE" ? ` (${c.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Faction</span>
          <select
            value={filters.factions[0] ?? ""}
            onChange={(e) => set({ factions: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Any</option>
            {factions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Zone</span>
          <select
            value={filters.zones[0] ?? ""}
            onChange={(e) => set({ zones: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Any</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          {/* The zone a row belongs to is its target's FACTION zone, never
              where they happen to be standing — the rule ZoneChip states. */}
          <span className="text-muted text-xs">By the character&rsquo;s faction.</span>
        </label>
      </Group>

      <Group label="When">
        <div className="audit-chips">
          {Object.entries(DATE_PRESETS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              data-active={filters.preset === key || undefined}
              aria-pressed={filters.preset === key}
              onClick={() => set({ preset: filters.preset === key ? "" : key })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="audit-pair">
          <label className="field">
            <span className="field-label">Turn from</span>
            <select value={filters.turnFrom} onChange={(e) => set({ turnFrom: e.target.value })}>
              <option value="">—</option>
              {turnNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Turn to</span>
            <select value={filters.turnTo} onChange={(e) => set({ turnTo: e.target.value })}>
              <option value="">—</option>
              {turnNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="audit-pair">
          <label className="field">
            <span className="field-label">From</span>
            <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">To</span>
            <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>
      </Group>

      {active ? (
        <button type="button" className="btn-quiet" onClick={() => set(null)}>
          Clear every filter
        </button>
      ) : null}
    </div>
  );
}

function Group({ label, children }) {
  return (
    <section className="audit-group">
      <h2 className="audit-group-title">{label}</h2>
      {children}
    </section>
  );
}
