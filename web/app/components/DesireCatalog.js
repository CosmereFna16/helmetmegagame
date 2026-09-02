"use client";

import { useMemo, useState } from "react";
import Modal from "./Modal";
import StatusPill from "./StatusPill";
import ChipText from "./ChipText";
import RichText from "./RichText";
import Select from "./Select";
import CheckField from "./CheckField";
import { formatCost, costColor } from "@/lib/characterCreation";

// A Desire's award, in the same voice as a Point Buy price: `+3 pts`,
// `+1 pt`. Tier IS the award, and formatCost/costColor read a NEGATIVE cost
// as "grants points", so the number lands in --positive like a drawback's.
export function formatDesirePoints(tier) {
  return `${formatCost(-tier)} ${tier === 1 ? "pt" : "pts"}`;
}

// A Desire's own cooldown, in words: "3-turn cooldown", or "once ever" for
// a template that can only be fulfilled once per life (tier 7 by default).
// `cooldownTurns` arrives already resolved (cooldownTurns ?? tier) from
// character/page.js, or as the raw template off a past claim — so resolve
// again here, cheaply, rather than trust which one a caller handed over.
// Null when nothing is known (a GM free-text Desire has no template).
export function cooldownLabel(t) {
  if (!t) return null;
  if (t.onceEver) return "once ever";
  const n = t.cooldownTurns ?? t.tier;
  return n != null ? `${n}-turn cooldown` : null;
}

const OTHER = { key: "__other", name: "Other", group: null, color: null };

// The states a row can arrive in. "locked" never reaches this component —
// character/page.js drops it server-side, so a gate you fail is simply not
// in the list — and "hidden" never even leaves db/lib/desireGates.js.
function rowState(entry) {
  switch (entry.state) {
    case "cooldown":
      return {
        tone: "warn",
        label: entry.availableFromTurn != null ? `Back on turn ${entry.availableFromTurn}` : "Cooling down",
      };
    case "spent":
      return { tone: "muted", label: "Done" };
    default:
      return null;
  }
}

// One pickable row, PointBuy's TagRow with the tag facts swapped for a
// Desire's: the family colour as the left rule (the select-card comment
// sanctions that one inline colour), the award where the price sits, and the
// other families a multi-family desire carries where the group name goes.
// ChipText rather than RichText: the row is a <button>, so a hoverable chip
// inside it would be a button in a button.
function DesireRow({ entry, family, otherNames, onChoose }) {
  const state = rowState(entry);
  const pickable = entry.state === "available";
  return (
    <li>
      <button
        type="button"
        onClick={() => onChoose(entry)}
        disabled={!pickable}
        className="select-card panel flex w-full items-start gap-3 p-3 text-left"
        style={family?.color ? { borderLeftColor: family.color, borderLeftWidth: 3 } : undefined}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-sm"
          style={{ color: "var(--muted)" }}
        >
          ◇
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <ChipText text={entry.name} as="span" />
            <span className="text-sm" style={{ color: costColor(-entry.tier) }}>
              {formatDesirePoints(entry.tier)}
            </span>
            <span className="text-xs text-muted">{cooldownLabel(entry)}</span>
            {otherNames.length > 0 && (
              <span className="text-xs text-muted">{otherNames.join(" · ")}</span>
            )}
            {/* The source column: what opened this row to you — a held tag,
                your role — or nothing at all for a Desire open to everyone.
                Pushed to the row's end so the eye can run down it. Named
                server-side (desireGates.js#unlockedBy), never guessed here. */}
            {entry.unlockedBy && (
              <span className="ml-auto text-xs" style={{ color: "var(--accent-text)" }}>
                Unlocked by {entry.unlockedBy}
              </span>
            )}
          </span>
          {state && <StatusPill tone={state.tone}>{state.label}</StatusPill>}
        </span>
      </button>
    </li>
  );
}

// One of your slots, in the "Your slots" pane. An open slot is a select-card
// you can retarget the claim at — the modal opens aimed at the slot whose
// button was pressed, but nothing stops you claiming into the other one
// instead, and which slot you pick matters when an Addiction binds the bottom
// one. A cooling slot can't take a claim, so it's disabled; claimDesire
// refuses it server-side anyway.
function SlotCard({ slot, isTarget, isBottom, addiction, onTarget }) {
  const open = slot.lockedUntilTurn == null;
  return (
    <li>
      <button
        type="button"
        className="select-card panel flex w-full flex-col gap-1 p-3 text-left"
        aria-pressed={isTarget}
        disabled={!open}
        onClick={() => onTarget(slot.slotIndex)}
      >
        <span className="text-xs font-bold uppercase tracking-wide text-muted">
          Slot {slot.slotIndex + 1}
          {isBottom && addiction ? ` · ${addiction.name}` : ""}
        </span>
        {slot.lockedUntilTurn != null ? (
          <span className="text-sm text-muted">Opens on turn {slot.lockedUntilTurn}</span>
        ) : (
          <span className="text-sm" style={{ color: isTarget ? "var(--accent-text)" : "var(--muted)" }}>
            {isTarget ? "Claiming into this slot" : "Open"}
          </span>
        )}
        {slot.lastEnded && (
          <span className="text-sm text-muted">
            Last:{" "}
            <RichText text={slot.lastEnded.text} as="span" />{" "}
            <span style={{ color: costColor(-slot.lastEnded.points) }}>
              {formatDesirePoints(slot.lastEnded.points)}
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

// The catalog picker: the Spend Tag Points menu's layout (PointBuy.js) with
// Desires in it. Catalog pane on the left — search, sort, a tab per family
// group, one tall scroller with a sticky coloured header per family — and
// your slots on the right. `catalog` is already gate-evaluated and already
// stripped of everything you can't see or can't pick for a gate reason
// (character/page.js); what's left is yours, and only cooldown and
// once-ever-done rows sit dimmed among the claimable ones.
//
// The one gate this component applies itself is the SLOT-scoped one: an
// Addiction shuts the bottom slot to everything outside its own family, so a
// row's `slotLocks[target]` decides whether it is in this list at all — and
// retargeting a slot re-filters the catalog.
//
// Mount this with a `key` that changes per opening: every bit of state here
// (search, tab, target slot) is meant to reset when the modal is reopened.
//
// Picking a row posts nothing. It hands the choice back to DesirePanel, which
// opens the reason dialog — a claim moves Tag Points, so it is a request and
// needs a reason like every other one.
export default function DesireCatalog({
  open,
  onClose,
  onChoose,
  slotIndex,
  desireSlots = 2,
  slotStates = [],
  catalog = [],
  families = [],
  familyGroups = [],
  lockNotes = [],
  addiction = null,
}) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("family");
  const [tab, setTab] = useState("all");
  // "Unlocked by your tags": only rows sitting behind a gate you pass — the
  // role and personality-specific Desires that would otherwise drown in the
  // open catalog. Same filter, same wording, as PointBuy's.
  const [requiresOnly, setRequiresOnly] = useState(false);
  const [target, setTarget] = useState(slotIndex);

  const familyByKey = useMemo(() => new Map(families.map((f) => [f.key, f])), [families]);
  const groupByKey = useMemo(() => new Map(familyGroups.map((g) => [g.key, g])), [familyGroups]);

  // Each desire appears ONCE, under the first family it names — a
  // multi-family desire shows its other families beside its name instead
  // of repeating as a row per family, which doubled a 270-row list.
  const rows = useMemo(
    () =>
      catalog
        .filter((entry) => !entry.slotLocks?.[target])
        .filter((entry) => !requiresOnly || entry.unlockedBy)
        .map((entry) => {
          const known = (entry.families ?? []).filter((k) => familyByKey.has(k));
          const family = known.length > 0 ? familyByKey.get(known[0]) : OTHER;
          const otherNames = known.slice(1).map((k) => familyByKey.get(k).name);
          const group = (family.group && groupByKey.get(family.group)) || null;
          return { entry, family, otherNames, group };
        }),
    [catalog, familyByKey, groupByKey, requiresOnly, target],
  );

  // Tabs come from what's actually on offer, in header order, so a family
  // group you hold nothing in (an Alcoholic's whole catalog outside Alcohol,
  // a hidden order you're not part of) has no tab at all.
  const tabs = useMemo(() => {
    const present = new Set(rows.map((r) => r.group?.key ?? "__other"));
    const list = familyGroups.filter((g) => present.has(g.key)).map((g) => ({ key: g.key, name: g.name }));
    if (present.has("__other")) list.push({ key: "__other", name: "Other" });
    return list;
  }, [rows, familyGroups]);
  const activeTab = tab === "all" || tabs.some((t) => t.key === tab) ? tab : "all";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = activeTab === "all" ? rows : rows.filter((r) => (r.group?.key ?? "__other") === activeTab);
    if (q) {
      list = list.filter(
        (r) =>
          r.entry.name.toLowerCase().includes(q) ||
          r.family.name.toLowerCase().includes(q) ||
          r.otherNames.some((n) => n.toLowerCase().includes(q)),
      );
    }
    if (sortMode === "tier") {
      list = [...list].sort((a, b) => b.entry.tier - a.entry.tier || a.entry.name.localeCompare(b.entry.name));
    } else if (sortMode === "name") {
      list = [...list].sort((a, b) => a.entry.name.localeCompare(b.entry.name));
    }
    return list;
  }, [rows, activeTab, query, sortMode]);

  // The family view renders sticky headers per family, in header order; the
  // flat sorts (Name, Tier) skip the headers entirely — a header over a
  // tier-sorted list would repeat itself every other row.
  const sections = useMemo(() => {
    if (sortMode !== "family") return [{ key: "flat", name: null, color: null, rows: visible }];
    const map = new Map();
    for (const row of visible) {
      const key = row.family.key;
      if (!map.has(key)) map.set(key, { key, name: row.family.name, color: row.family.color, rows: [] });
      map.get(key).rows.push(row);
    }
    const order = new Map([...families.map((f, i) => [f.key, i]), ["__other", families.length]]);
    return [...map.values()].sort((a, b) => order.get(a.key) - order.get(b.key));
  }, [visible, sortMode, families]);

  const bySlot = new Map(slotStates.map((s) => [s.slotIndex, s]));
  const slots = Array.from(
    { length: desireSlots },
    (_, i) => bySlot.get(i) ?? { slotIndex: i, lockedUntilTurn: null, lastEnded: null },
  );
  const openSlots = slots.filter((s) => s.lockedUntilTurn == null).length;
  const bottomIndex = desireSlots - 1;

  function choose(entry) {
    onChoose?.({ entry, slotIndex: target });
  }

  return (
    <Modal open={open} title="Claim a Desire" onClose={() => onClose?.()} width="widest">
      <div className="mt-3 flex flex-col gap-4">
        {/* Mobile target bar: the slots pane stacks below the catalog on
            small screens, so which slot the pick lands in stays in view. */}
        <div
          className="panel sticky top-0 z-10 flex items-center justify-between gap-3 p-3 text-sm md:hidden"
          aria-hidden="true"
        >
          <span className="text-muted">Claiming into</span>
          <strong>
            Slot {target + 1}
            <span className="text-muted font-normal"> · {openSlots} of {desireSlots} open</span>
          </strong>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          {/* ----- Catalog ----- */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="field min-w-40 flex-1">
                <span className="field-label">Search</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or family"
                  data-autofocus
                />
              </label>
              <label className="field">
                <span className="field-label">Sort</span>
                <Select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  <option value="family">Family</option>
                  <option value="tier">Points, high first</option>
                  <option value="name">Name A–Z</option>
                </Select>
              </label>
              <CheckField
                checked={requiresOnly}
                onChange={(e) => setRequiresOnly(e.target.checked)}
                className="pb-2"
              >
                Unlocked by your tags
              </CheckField>
            </div>

            {/* What a held tag has shut. The locked rows themselves are not
                in this list at all, so this is the only place the narrowing
                is explained. */}
            {lockNotes.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-muted">
                {lockNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            {tabs.length > 1 && (
              <div className="tab-bar">
                <button
                  type="button"
                  className="tab-item"
                  data-active={activeTab === "all"}
                  onClick={() => setTab("all")}
                >
                  All
                </button>
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className="tab-item"
                    data-active={t.key === activeTab}
                    onClick={() => setTab(t.key)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}

            {/* The catalog scrolls itself rather than growing the modal — the
                slots pane must stay reachable however long the list gets. */}
            <div className="flex flex-col gap-3 overflow-y-auto pr-1" style={{ maxHeight: "62vh" }}>
              {sections.map((section) => (
                <div key={section.key} className="flex flex-col gap-2">
                  {section.name && (
                    <div
                      className="sticky top-0 z-[1] flex items-center gap-2 py-1 text-xs font-bold uppercase tracking-wide text-muted"
                      style={{ background: "var(--bg)" }}
                    >
                      {/* A family colour is a freeform hex out of
                          docs/desires.yaml, used raw — same as a TagGroup's. */}
                      {section.color && (
                        <span
                          aria-hidden="true"
                          className="inline-block h-3 w-1 rounded-sm"
                          style={{ background: section.color }}
                        />
                      )}
                      {section.name}
                      <span className="font-normal normal-case">({section.rows.length})</span>
                    </div>
                  )}
                  <ul className="flex flex-col gap-2">
                    {section.rows.map((row) => (
                      <DesireRow
                        key={row.entry.slug}
                        entry={row.entry}
                        family={row.family}
                        otherNames={row.otherNames}
                        onChoose={choose}
                      />
                    ))}
                  </ul>
                </div>
              ))}

              {visible.length === 0 && (
                <p className="text-sm text-muted">
                  {query ? `Nothing matches "${query}".` : "Nothing available right now."}
                </p>
              )}
            </div>
          </div>

          {/* ----- Your Desires ----- */}
          <aside className="panel flex flex-col gap-3 p-4 md:sticky md:top-4">
            <h2 className="panel-header" style={{ margin: 0 }}>
              Your slots
            </h2>
            <div className="text-sm text-muted">
              {openSlots} of {desireSlots} slot{desireSlots === 1 ? "" : "s"} open
            </div>
            <ul className="flex flex-col gap-2">
              {slots.map((slot) => (
                <SlotCard
                  key={slot.slotIndex}
                  slot={slot}
                  isTarget={slot.slotIndex === target}
                  isBottom={slot.slotIndex === bottomIndex}
                  addiction={addiction}
                  onTarget={setTarget}
                />
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
