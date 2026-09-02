"use client";

import { useMemo, useState } from "react";
import {
  purchasableTags,
  sortForMode,
  menuCategories,
  formatCost,
  costColor,
  tagsById as buildTagsById,
  effectiveCost,
  effectiveTotalCost,
  chainSiblingsToRemove,
  heldHigherTiers,
  unlockedTags,
  filterTagsByQuery,
  prerequisiteNames,
  hasPrerequisite,
  negativeTagCount,
  exclusiveConflict,
  conflictingTag,
} from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import ChipText from "./ChipText";
import ChipLabel from "./ChipLabel";
import CheckField from "./CheckField";
import HoverCard from "./HoverCard";
import Select from "./Select";

// The point-buy experience, shared by both stores: a catalog pane on the
// left, "Your Build" on the right (Project Zomboid's trait screen is the
// reference). Character creation and the mid-game /store mount the SAME
// component so the two read as one system.
//
// `afterStartOnly` is the single catalog difference between them: creation
// passes false and offers every purchasable tag, while the store passes true
// and offers only tags still buyable once play is underway — so a pick like
// "Secretly an Android" can be a launch-day option and never a mid-game one.
//
// `grantedTags` is what the buyer already owns before this purchase: the
// role's starting tags at creation, the character's whole sheet in the
// store. They discount chain upgrades (effectiveCost) and satisfy
// requirements, and the build pane lists them read-only.
//
// `actions` is an optional node rendered at the foot of the build pane —
// the store puts its checkout button there; the wizard needs nothing.
//
// `negativeCap` / `negativeHeld` are the drawback limit (TAGS.md §4a): at
// most `negativeCap` drawback TAGS bought through this menu, with
// `negativeHeld` already held elsewhere. It is a CHARACTER CREATION rule and
// only creation passes it (the cap and 0 held). The store passes neither: the
// Addictions are deliberately buyable mid-game (TAGS.md §4), so a cap the
// store neither enforces nor moves would be a misleading readout. A null cap
// renders nothing at all and dims nothing.

// A name in one of the build pane's two lists, with the catalog row's own
// detail on hover. The pane is deliberately narrow and its list scrolls, so
// the description cannot simply be printed under every name the way TagRow
// prints it — HoverCard is what makes that workable here. It portals to
// document.body, so the panel escapes the list's overflow-y-auto instead of
// being clipped by it, and a click pins it open, which is the whole touch
// story. Same facts as TagRow below, so a pick reads the same in both places.
function BuildTagName({ tag }) {
  const panel = (
    <>
      <div className="flex items-start justify-between gap-2">
        <strong>{tag.name}</strong>
        {(tag.group?.name || tag.category) && (
          <span className="text-muted whitespace-nowrap text-xs">
            {[tag.group?.name, tag.category].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      {/* inTooltip, same as TagChip's description: this is a HoverCard panel,
          so a nested {tag:…} becomes a real chip, reachable once pinned. */}
      {tag.description && <ChipText text={tag.description} as="p" inTooltip />}
      {formatTagRequirement(tag) && (
        <p className="text-muted">{formatTagRequirement(tag)}</p>
      )}
      {prerequisiteNames(tag).length > 0 && (
        <p style={{ color: "var(--accent-text)" }}>
          Requires: {prerequisiteNames(tag).join(", ")}
        </p>
      )}
    </>
  );
  return (
    // color: inherit because .tag-hover declares --text, which would light up
    // the "Granted free" list that is deliberately muted.
    <HoverCard
      panel={panel}
      className="min-w-0 max-w-full"
      style={{ color: "inherit" }}
    >
      <span className="truncate">{tag.name}</span>
    </HoverCard>
  );
}

function TagRow({ tag, isSelected, cost, unaffordable, conflictName, onToggle }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(tag)}
        aria-pressed={isSelected}
        className="select-card panel flex w-full items-start gap-3 p-3 text-left"
        data-unaffordable={unaffordable || undefined}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-sm"
          style={{ color: isSelected ? "var(--accent-text)" : "var(--muted)" }}
        >
          {isSelected ? "◆" : "◇"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <ChipLabel tag={tag} />
            <span className="text-sm" style={{ color: costColor(cost) }}>
              {formatCost(cost)}
            </span>
            {tag.group?.name && <span className="text-xs text-muted">{tag.group.name}</span>}
          </span>
          {/* ChipText rather than RichText: the row is a <button>, so a
              hoverable chip inside it would be a button in a button. */}
          {tag.description && (
            <ChipText text={tag.description} as="span" className="text-sm text-muted" />
          )}
          {formatTagRequirement(tag) && (
            <span className="text-sm text-muted">{formatTagRequirement(tag)}</span>
          )}
          {/* The gate that unlocked this row — a Brigand's gear or a Fighting
              sidegrade would otherwise be indistinguishable from the open
              catalog. Only qualifying viewers ever see the row, so naming the
              gate leaks nothing. Distinct from formatTagRequirement above,
              which is the in-play add/remove cost block. */}
          {prerequisiteNames(tag).length > 0 && (
            <span className="text-sm" style={{ color: "var(--accent-text)" }}>
              Requires: {prerequisiteNames(tag).join(", ")}
            </span>
          )}
          {/* The exclusivity rule, named rather than merely dimmed — a row
              that greys out with no reason reads as a bug. Only ever set for
              a conflict with something ALREADY held/granted, which is the
              case a click can't resolve; a conflict with another PICK swaps
              instead (see toggle). */}
          {conflictName && (
            <span className="text-sm" style={{ color: "var(--accent-text)" }}>
              Can&apos;t be held with {conflictName}.
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function PointBuy({
  tags,
  budget,
  grantedTags = [],
  afterStartOnly = false,
  selectedIds,
  onChange,
  actions = null,
  negativeCap = null,
  negativeHeld = 0,
}) {
  // Full catalog by id, not just what's on offer, so a chain walk
  // (parentTagId) never dead-ends on a tag this menu happens to filter out.
  const byId = useMemo(() => buildTagsById(tags), [tags]);

  const offered = useMemo(
    () => purchasableTags({ tags, afterStartOnly, grantedNames: grantedTags.map((t) => t.name) }),
    [tags, afterStartOnly, grantedTags],
  );

  // "Held" for cost/requirement purposes = granted-for-free tags plus
  // whatever's currently selected — a chain tier already granted/owned
  // discounts a purchase the same way an already-selected lower tier does.
  const grantedIds = useMemo(() => grantedTags.map((t) => t.id), [grantedTags]);
  const heldOrSelectedIds = useMemo(
    () => [...grantedIds, ...selectedIds],
    [grantedIds, selectedIds],
  );

  // Requirement filtering happens BEFORE the tabs are derived, not per row:
  // a category whose every tag is gated (Demoness, Bacchus) must have no tab
  // at all. Selected tags stay in, so unticking one can't make it vanish
  // mid-interaction.
  const gateChecked = useMemo(
    () => unlockedTags(offered, byId, heldOrSelectedIds, selectedIds),
    [offered, byId, heldOrSelectedIds, selectedIds],
  );

  // A tier at or below one already granted/held is not a purchase: a rung
  // BELOW a held tier is a downgrade (heldHigherTiers — a chain replaces
  // upward, it never re-opens downward), and a rung at-or-under one paid
  // through has an effective cost of zero or a refund. The store is where
  // this bites (grantedTags = the whole sheet), and buyTags rejects both
  // server-side too.
  const unlocked = useMemo(
    () =>
      gateChecked.filter(
        (t) =>
          selectedIds.includes(t.id) ||
          (heldHigherTiers(t, byId, grantedIds).length === 0 &&
            (chainSiblingsToRemove(t, byId, grantedIds).length === 0 ||
              effectiveCost(t, byId, grantedIds) > 0)),
      ),
    [gateChecked, byId, grantedIds, selectedIds],
  );

  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("cost");
  const [groupFilter, setGroupFilter] = useState("");
  // "Unlocked by your tags": only tags sitting behind a prerequisite gate.
  // Everything on offer already passed unlockedTags, so gated-and-shown
  // means gated-and-met — the role/faction-specific kit that would
  // otherwise drown in the open catalog.
  const [requiresOnly, setRequiresOnly] = useState(false);

  // Search runs AFTER unlockedTags, never instead of it: a gated tag must
  // stay invisible no matter what someone types. The category tabs are still
  // derived from `unlocked` rather than the searched set, so narrowing a
  // search can't make the tab you're standing on disappear underneath you.
  // The prerequisite filter narrows BEFORE the tabs are derived, same as the
  // gates: ticking it collapses the tab bar to just the categories holding
  // gated tags, instead of leaving empty tabs to click through. `active`
  // below is derived, so a vanished tab falls back without an effect.
  const pool = useMemo(
    () => (requiresOnly ? unlocked.filter(hasPrerequisite) : unlocked),
    [unlocked, requiresOnly],
  );

  const categories = useMemo(() => menuCategories(pool), [pool]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];

  const inCategory = useMemo(
    () => pool.filter((t) => t.category === active),
    [pool, active],
  );

  // Group filter options come from the whole active category, not the
  // searched subset, so the select's options don't churn while typing.
  const groupOptions = useMemo(() => {
    const seen = new Map();
    for (const t of inCategory) {
      if (t.group?.slug && !seen.has(t.group.slug)) seen.set(t.group.slug, t.group.name);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [inCategory]);
  const activeGroupFilter = groupOptions.some(([slug]) => slug === groupFilter)
    ? groupFilter
    : "";

  const selected = useMemo(
    () => offered.filter((t) => selectedIds.includes(t.id)),
    [offered, selectedIds],
  );
  // Discounted by granted/held chain tiers — the same arithmetic the rows
  // show and the server actions enforce.
  const spent = effectiveTotalCost(selected, byId, grantedIds);
  const remaining = budget - spent;

  // Drawback tags are counted, never discounted — see negativeTagCount.
  // The cap is soft in exactly the same way the budget is: a click still
  // selects, and the build pane says why the build isn't legal yet. A dimmed
  // row that swallowed the click would leave the player with no explanation.
  const negativeSelected = negativeTagCount(selected);
  const negativeUsed = negativeHeld + negativeSelected;
  const capped = negativeCap != null;
  const overCap = capped && negativeUsed > negativeCap;
  // "Drop one to continue" is only true advice if dropping something in THIS
  // menu would help. A character grandfathered in over the cap opens /store
  // already over it with an empty cart and nothing to drop, so there the
  // count still reads red but the instruction stays quiet.
  const canFixCap = overCap && negativeSelected > 0;

  function toggle(tag) {
    if (selectedIds.includes(tag.id)) {
      onChange(selectedIds.filter((id) => id !== tag.id));
      return;
    }
    // One rung per chain in the cart, whichever direction the click came
    // from: picking a higher tier drops a selected lower one (ancestors),
    // and picking a lower tier swaps out a selected higher one (descendants)
    // rather than double-selecting.
    const siblings = new Set([
      ...chainSiblingsToRemove(tag, byId, selectedIds),
      ...heldHigherTiers(tag, byId, selectedIds),
    ]);
    // Exclusive tags (the Beliefs) swap the same way a chain does when the
    // conflict is another PICK — a player changing their mind about which
    // belief to take shouldn't have to untick the old one first. A conflict
    // with something already held/granted can't be swapped away here, so
    // that row is dimmed and named instead (rowFor below).
    // Named conflict pairs (Tag.conflictsWith) swap the same way when the
    // conflict is another PICK, for the same reason exclusive tags do —
    // a conflict with something already held/granted can't be swapped away
    // here, so that row is dimmed and named instead (rowFor below).
    const conflict = exclusiveConflict(tag, selectedIds, byId) ?? conflictingTag(tag, selectedIds, byId);
    if (conflict) siblings.add(conflict.id);
    onChange([...selectedIds.filter((id) => !siblings.has(id)), tag.id]);
  }

  const visible = useMemo(() => {
    const groupNarrowed = activeGroupFilter
      ? inCategory.filter((t) => t.group?.slug === activeGroupFilter)
      : inCategory;
    return sortForMode(filterTagsByQuery(groupNarrowed, query), sortMode, byId);
  }, [inCategory, activeGroupFilter, query, sortMode, byId]);

  // The grouped view renders sticky headers per TagGroup; the flat sorts
  // (Name, Cost) skip the headers entirely — a header over a cost-sorted
  // list would repeat itself every other row.
  const sections = useMemo(() => {
    if (sortMode !== "group") return [{ key: "flat", name: null, color: null, tags: visible }];
    const map = new Map();
    for (const tag of visible) {
      const key = tag.group?.slug ?? "__other";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: tag.group?.name ?? "Other",
          color: tag.group?.color ?? null,
          tags: [],
        });
      }
      map.get(key).tags.push(tag);
    }
    return [...map.values()].sort(
      (a, b) => (a.key === "__other") - (b.key === "__other") || a.name.localeCompare(b.name),
    );
  }, [visible, sortMode]);

  const rowFor = (tag) => {
    const isSelected = selectedIds.includes(tag.id);
    const cost = effectiveCost(tag, byId, heldOrSelectedIds);
    // A tag you can't currently afford is still shown, just marked — hiding
    // it would make the catalog feel like it changes shape. A locked one
    // (unmet requiredTag, or an unmet group gate) never reaches here at all:
    // `unlocked` above dropped it, along with its category tab.
    const unaffordable = !isSelected && cost > remaining;
    // A drawback that would push the tag count past the cap is dimmed the
    // same way an unaffordable tag is: both are "you can't take this right
    // now", and reusing the one state means no second visual language for
    // the same idea. Every qualifying drawback costs exactly one slot of the
    // cap now, so it's blocked once the cap is already reached.
    const capBlocked = !isSelected && capped && (tag.pointCost ?? 0) < 0 && negativeUsed >= negativeCap;
    // Only against grantedIds: a conflict with another pick is resolved by
    // swapping (toggle), so dimming it too would make the swap look forbidden.
    const conflict = isSelected
      ? null
      : exclusiveConflict(tag, grantedIds, byId) ?? conflictingTag(tag, grantedIds, byId);
    return (
      <TagRow
        key={tag.id}
        tag={tag}
        isSelected={isSelected}
        cost={cost}
        unaffordable={unaffordable || capBlocked || Boolean(conflict)}
        conflictName={conflict?.name ?? null}
        onToggle={toggle}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Mobile budget bar: the build pane stacks below the catalog on small
          screens, so the number that gates every decision stays in view. */}
      <div
        className="panel sticky top-0 z-10 flex items-center justify-between gap-3 p-3 text-sm md:hidden"
        aria-hidden="true"
      >
        <span className="text-muted">Points remaining</span>
        <span className="flex items-center gap-3">
          {/* The drawback count gates the build the same way the budget
              does, so on mobile it has to ride the same sticky bar. */}
          {capped && (
            <span style={{ color: overCap ? "var(--danger)" : "var(--muted)" }}>
              {negativeUsed}/{negativeCap} drawbacks
            </span>
          )}
          <strong style={{ color: remaining < 0 ? "var(--accent-text)" : "var(--text)" }}>
            {remaining}
            <span className="text-muted"> / {budget}</span>
          </strong>
        </span>
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
                placeholder="Name, description, or group"
              />
            </label>
            <label className="field">
              <span className="field-label">Sort</span>
              <Select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="group">Group</option>
                <option value="name">Name A–Z</option>
                <option value="cost">Cost</option>
              </Select>
            </label>
            {groupOptions.length > 1 && (
              <label className="field">
                <span className="field-label">Group</span>
                <Select value={activeGroupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                  <option value="">All</option>
                  {groupOptions.map(([slug, name]) => (
                    <option key={slug} value={slug}>
                      {name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <CheckField
              checked={requiresOnly}
              onChange={(e) => setRequiresOnly(e.target.checked)}
              className="pb-2"
            >
              Unlocked by your tags
            </CheckField>
          </div>

          <div className="tab-bar">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className="tab-item"
                data-active={c === active}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {/* The catalog scrolls itself rather than growing the page — the
              build pane must stay reachable however long Items gets. */}
          <div className="flex flex-col gap-3 overflow-y-auto pr-1" style={{ maxHeight: "62vh" }}>
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col gap-2">
                {section.name && (
                  <div
                    className="sticky top-0 z-[1] flex items-center gap-2 py-1 text-xs font-bold uppercase tracking-wide text-muted"
                    style={{ background: "var(--bg)" }}
                  >
                    {/* TagGroup.color is a freeform hex out of the DB, used
                        raw — same as TagChip.js. */}
                    {section.color && (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-1 rounded-sm"
                        style={{ background: section.color }}
                      />
                    )}
                    {section.name}
                    <span className="font-normal normal-case">({section.tags.length})</span>
                  </div>
                )}
                {/* Deliberately a toggle-set, with no quantity anywhere: a
                    bought tag lands on CharacterTag.quantity's default of 1,
                    so a stackable tag can never be point-farmed. Stacks are
                    built in play, through the Add Tag request. */}
                <ul className="flex flex-col gap-2">{section.tags.map(rowFor)}</ul>
              </div>
            ))}

            {visible.length === 0 && (
              <p className="text-sm text-muted">
                {query
                  ? `Nothing in ${active} matches "${query}".`
                  : "Nothing available in this category."}
              </p>
            )}
          </div>
        </div>

        {/* ----- Your Build ----- */}
        <aside className="panel flex flex-col gap-3 p-4 md:sticky md:top-4">
          <h2 className="panel-header" style={{ margin: 0 }}>
            Your Build
          </h2>
          <div aria-live="polite">
            <div
              className="text-2xl font-bold"
              style={{ color: remaining < 0 ? "var(--accent-text)" : "var(--text)" }}
            >
              {remaining}
            </div>
            <div className="text-sm text-muted">
              points remaining · {spent} / {budget} spent
            </div>
            {capped && (
              <div
                className="text-sm font-bold"
                style={{ color: overCap ? "var(--danger)" : "var(--muted)" }}
              >
                {negativeUsed} / {negativeCap} drawbacks taken
              </div>
            )}
          </div>
          {remaining < 0 && (
            <p className="text-sm text-accent">
              Over budget by {Math.abs(remaining)}. Drop something to continue.
            </p>
          )}
          {canFixCap && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {negativeUsed} drawbacks taken; the limit is {negativeCap}. Drop{" "}
              {negativeUsed - negativeCap === 1 ? "one" : `${negativeUsed - negativeCap}`} to continue.
            </p>
          )}

          {grantedTags.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">
                {afterStartOnly ? "Already yours" : "Granted free"}
              </span>
              <ul className="flex flex-col">
                {grantedTags.map((t) => (
                  <li key={t.id} className="flex text-sm text-muted">
                    <BuildTagName tag={t} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex min-h-0 flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">
              Picked ({selected.length})
            </span>
            {selected.length === 0 ? (
              <p className="text-sm text-muted">Nothing picked yet.</p>
            ) : (
              <ul className="flex flex-col overflow-y-auto" style={{ maxHeight: "18rem" }}>
                {selected.map((t) => {
                  const cost = effectiveCost(t, byId, grantedIds);
                  return (
                    <li key={t.id} className="flex items-center gap-2 py-1 text-sm">
                      <span className="flex min-w-0 flex-1">
                        <BuildTagName tag={t} />
                      </span>
                      <span style={{ color: costColor(cost) }}>{formatCost(cost)}</span>
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => toggle(t)}
                        aria-label={`Remove ${t.name}`}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {actions}
        </aside>
      </div>
    </div>
  );
}
