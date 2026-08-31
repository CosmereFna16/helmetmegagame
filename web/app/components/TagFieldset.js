"use client";

import { useMemo, useState } from "react";
import CheckField from "@/app/components/CheckField";
import Select from "@/app/components/Select";
import InfoIcon from "@/app/components/InfoIcon";
import { filterTagsByQuery } from "@/lib/characterCreation";

// The one tag form body, shared by both doors a GM authors a tag through:
// the quick CustomTagDialog (create + assign, reached from the Dev Panel's
// Tags tab and the adjudication desk) and TagCatalog.js's edit dialog. They
// used to carry two different field sets — the quick one sent five fields and
// the edit one sixteen — so a tag invented mid-adjudication couldn't expire,
// stack, or be worn until the GM walked to /gm/dev/tags and edited it. One
// component means they can't drift again.
//
// Renders no modal and no submit button: a controlled body over `values` plus
// a `set(key, value)` setter, so each door keeps its own chrome.
//
// The field set stops where docs/tags.yaml's authority starts. parentTagId,
// requiredTagId, exclusive, depotPrice and the consumesInto family stay out —
// they wire tags to each other, which is catalog structure that belongs in a
// reviewed, version-controlled file (see the note on scalarsFrom in
// gm/dev/tags/actions.js). The two chains — expiresInto and removesInto —
// are the deliberate exception: an untreated wound getting worse (and a
// treated one leaving its aftermath) is the whole point of a homebrew
// injury, and both point at existing tags rather than restructuring them.

// Tag.inspectVisibility — the one tag setting that is not a boolean, since a
// stowed dagger and a drawn one are different things to look at. WORN needs
// the tag to be equippable; the server re-checks it (actions.js#scalarsFrom).
const VISIBILITY_OPTIONS = [
  ["HIDDEN", "Never"],
  ["ALWAYS", "Always"],
  ["WORN", "Only while equipped"],
];

const BEHAVIOUR_FIELDS = [
  ["stackable", "Stackable (a character can hold several)"],
  ["equippable", "Equippable (takes a slot)"],
  ["consumable", "Consumable"],
  ["removable", "Player can drop it"],
  // Spelled out because it is easy to leave unchecked and then wonder why a
  // custom sword can't be handed over — it defaults off, and for an Item or an
  // Asset that is almost never what the GM meant.
  ["tradeable", "Tradeable (can be handed over, or looted off a body)"],
];

const ECONOMY_FLAGS = [
  ["purchasable", "Purchasable at creation"],
  ["purchasableAfterStart", "Still purchasable mid-game"],
];

// Every key the server's scalarsFrom reads, plus the two it handles specially
// (expiresInto's JSON and requirementSkills' relation). A door spreads this
// under an existing tag to edit one, or uses it as-is to create.
export const BLANK_TAG = {
  name: "",
  description: "",
  category: "",
  groupId: "",
  inspectVisibility: "HIDDEN",
  pointCost: 0,
  defaultDurationTurns: "",
  expiresInto: [],
  removesInto: [],
  stackable: false,
  equippable: false,
  concealsIdentity: false,
  consumable: false,
  removable: false,
  tradeable: false,
  purchasable: false,
  purchasableAfterStart: false,
  sellable: false,
  sellablePrice: null,
  requirementTurns: "",
  requirementResources: "",
  requirementGambit: false,
  skillTagIds: [],
};

// A tag row from any door's DTO, as form values.
//
// Every key is picked rather than spread, so the row's identity columns (id,
// slug, custom, held, the joined group) can't ride along into the server
// action's payload — the doors send `values` straight through, and a stray
// `slug` there would read as an attempt to set one, which is exactly what
// customSlug() exists to prevent.
//
// Two fields need shaping. expiresInto is stored as its normalized
// [{ oneOf: [...] }] JSON and used in that exact shape here, so nothing
// converts on the way in or out. requirementSkills is a Prisma relation that
// the form carries as a flat id list.
export function tagToFormValues(tag) {
  const values = { ...BLANK_TAG };
  for (const key of Object.keys(BLANK_TAG)) {
    if (tag?.[key] != null) values[key] = tag[key];
  }
  return {
    ...values,
    expiresInto: Array.isArray(tag?.expiresInto) ? tag.expiresInto : [],
    removesInto: Array.isArray(tag?.removesInto) ? tag.removesInto : [],
    defaultDurationTurns: tag?.defaultDurationTurns ?? "",
    requirementTurns: tag?.requirementTurns ?? "",
    requirementResources: tag?.requirementResources ?? "",
    skillTagIds: (tag?.requirementSkills ?? []).map((s) => s.id).filter(Boolean),
  };
}

// A search box over a scrollable checklist — the same shape CustomTagDialog's
// "Assign to" picker already uses for characters. `field` picks what a
// selection stores: expiresInto rows address tags by slug (the stored JSON
// holds slugs, and syncTags validates them as such), the cure ladder by id
// (it is a Prisma relation).
function TagPicker({ tags, selected, onToggle, field, emptyLabel }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => filterTagsByQuery(tags, query), [tags, query]);
  const chosen = useMemo(
    () => tags.filter((t) => selected.includes(t[field])),
    [tags, selected, field],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((t) => (
            <button key={t.id} type="button" className="chip" onClick={() => onToggle(t[field])}>
              {t.name} ✕
            </button>
          ))}
        </div>
      )}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tags…"
      />
      <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "9rem" }}>
        {matches.slice(0, 200).map((t) => (
          <CheckField
            key={t.id}
            checked={selected.includes(t[field])}
            onChange={() => onToggle(t[field])}
          >
            {t.name}
          </CheckField>
        ))}
        {matches.length === 0 && <p className="text-xs text-muted">{emptyLabel}</p>}
      </div>
    </div>
  );
}

export default function TagFieldset({
  values,
  set,
  categories = [],
  groups = null,
  tags = [],
  // The edit door opens Advanced, since a GM there came specifically to change
  // a field. The quick door leaves it closed — most invented tags are simple.
  advancedOpen = false,
  // The tag being edited, so it can't list itself as its own expiry outcome or
  // its own cure skill. Null when creating.
  selfId = null,
}) {
  const equippable = Boolean(values.equippable);
  const hasDuration = String(values.defaultDurationTurns ?? "").trim() !== "";
  // The expiry chain addresses tags by slug, and several doors trim their tag
  // rows to what their own list renders. A door whose rows have no slug drops
  // the picker rather than offering one whose selections would never match —
  // the same posture the Group field already takes when `groups` is omitted.
  const canPickSlugs = tags.some((t) => t.slug);
  // A tag can't turn into itself: the sweep deletes the expired row one
  // statement after the pass grants the replacement, so it would vanish. The
  // same rule syncTags.js enforces on the YAML.
  const otherTags = useMemo(
    () => (selfId ? tags.filter((t) => t.id !== selfId) : tags),
    [tags, selfId],
  );

  // Both chains (expiresInto, removesInto) share one row shape and these
  // helpers — `field` picks which list a row edit lands on.
  function setRow(field, index, slugs) {
    set(
      field,
      values[field].map((row, i) => (i === index ? { oneOf: slugs } : row)),
    );
  }

  function toggleInRow(field, index, slug) {
    const current = values[field][index]?.oneOf ?? [];
    setRow(field, index, current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]);
  }

  // The outcome rows + "+ Outcome" button one chain renders — shared by the
  // expiry chain and the removal chain, which differ only in their gate and
  // caption.
  function chainRows(field) {
    return (
      <>
        {values[field].map((row, i) => (
          <div key={i} className="panel flex flex-col gap-1.5 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {(row.oneOf ?? []).length > 1
                  ? `Outcome ${i + 1} — even pick between ${row.oneOf.length}`
                  : `Outcome ${i + 1}`}
              </span>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => set(field, values[field].filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
            <TagPicker
              tags={otherTags}
              selected={row.oneOf ?? []}
              onToggle={(slug) => toggleInRow(field, i, slug)}
              field="slug"
              emptyLabel="No tag matches that."
            />
          </div>
        ))}
        <button
          type="button"
          className="btn-quiet self-start"
          onClick={() => set(field, [...values[field], { oneOf: [] }])}
        >
          + Outcome
        </button>
      </>
    );
  }

  function toggleSkill(id) {
    const current = values.skillTagIds ?? [];
    set("skillTagIds", current.includes(id) ? current.filter((s) => s !== id) : [...current, id]);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Basics: what a GM inventing a tag on the spot actually fills in. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">
            Name <span className="text-accent">*</span>
          </span>
          <input value={values.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">
            Category <span className="text-accent">*</span>
          </span>
          <Select value={values.category} onChange={(e) => set("category", e.target.value)} required>
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </label>
        {groups && groups.length > 0 && (
          <label className="field">
            <span className="field-label">Group (colour accent only)</span>
            <Select value={values.groupId ?? ""} onChange={(e) => set("groupId", e.target.value)}>
              <option value="">(none)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Seen by others on 🔍</span>
          <Select
            value={values.inspectVisibility ?? "HIDDEN"}
            onChange={(e) => set("inspectVisibility", e.target.value)}
          >
            {VISIBILITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value} disabled={value === "WORN" && !equippable}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">Description</span>
        <textarea
          rows={3}
          value={values.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>

      {values.inspectVisibility === "WORN" && !equippable && (
        <p className="text-xs text-muted">
          Only an equippable tag can be seen just while it&apos;s worn — tick Equippable under
          Advanced, or the save is refused.
        </p>
      )}

      {/* ---- Everything else, folded away. The same <details> disclosure
              TagCatalogBrowser's rows use for descriptions. */}
      <details open={advancedOpen}>
        <summary className="cursor-pointer text-sm text-muted">
          Advanced — behaviour, lifespan, economy, curing
        </summary>

        <div className="flex flex-col gap-4 pt-3">
          <section className="flex flex-col gap-1.5">
            <span className="field-label">Behaviour</span>
            <div className="grid gap-1 sm:grid-cols-2">
              {BEHAVIOUR_FIELDS.map(([key, label]) => (
                <CheckField
                  key={key}
                  checked={Boolean(values[key])}
                  onChange={(e) => set(key, e.target.checked)}
                >
                  {label}
                </CheckField>
              ))}
              {/* Concealing is a property of something worn, so it means
                  nothing without equippable — the same pairing syncTags.js
                  enforces on the YAML, and the server re-checks it. */}
              <CheckField
                checked={Boolean(values.concealsIdentity)}
                disabled={!equippable}
                onChange={(e) => set("concealsIdentity", e.target.checked)}
              >
                Conceals identity {!equippable && "(needs Equippable)"}
              </CheckField>
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            <span className="field-label">Lifespan</span>
            <label className="field">
              <span className="field-label">Lasts (turns, blank for permanent)</span>
              <input
                type="number"
                min="1"
                value={values.defaultDurationTurns ?? ""}
                onChange={(e) => set("defaultDurationTurns", e.target.value)}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="field-label flex items-center gap-1.5">
                When it runs out, it becomes…
                <InfoIcon text="The untreated-wound chain: Infected becomes Festering rather than simply healing. Each outcome row grants one tag; pick two or more tags in a row for an even coin-flip between them." />
              </span>
              {!canPickSlugs && (
                <p className="text-xs text-muted">
                  Set this from the Tag Catalog — this door doesn&apos;t carry the tag slugs a chain
                  points at.
                </p>
              )}
              {canPickSlugs && !hasDuration && (
                <p className="text-xs text-muted">
                  Set a duration first — with no clock, nothing would ever fire these.
                </p>
              )}
              {canPickSlugs && hasDuration && chainRows("expiresInto")}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="field-label flex items-center gap-1.5">
                When treated or removed, it becomes…
                <InfoIcon text="The aftermath of a cure: Broken Bone treated becomes Splinted rather than simply vanishing. Fires when a player removes the tag or a medic heals it — never on a GM removal. Each outcome row grants one tag; pick two or more in a row for an even coin-flip. How long the aftermath lasts is set by its own duration." />
              </span>
              {!canPickSlugs && (
                <p className="text-xs text-muted">
                  Set this from the Tag Catalog — this door doesn&apos;t carry the tag slugs a chain
                  points at.
                </p>
              )}
              {canPickSlugs && chainRows("removesInto")}
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            <span className="field-label">Economy</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span className="field-label">Point cost (signed, catalog-style)</span>
                <input
                  type="number"
                  value={values.pointCost}
                  onChange={(e) => set("pointCost", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label flex items-center gap-1.5">
                  Sellable price
                  <InfoIcon text="Reference: a painting (4 turns to craft) sells for 60 ⬢. A flamethrower sells for 104 ⬢." />
                </span>
                <input
                  type="number"
                  min="1"
                  disabled={!values.sellable}
                  value={values.sellablePrice ?? ""}
                  onChange={(e) => set("sellablePrice", e.target.value)}
                />
              </label>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {ECONOMY_FLAGS.map(([key, label]) => (
                <CheckField
                  key={key}
                  checked={Boolean(values[key])}
                  onChange={(e) => set(key, e.target.checked)}
                >
                  {label}
                </CheckField>
              ))}
              <CheckField
                checked={Boolean(values.sellable)}
                onChange={(e) => set("sellable", e.target.checked)}
              >
                Sellable at Merchant&apos;s Depot
              </CheckField>
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            {/* One set of fields covers whichever direction the tag makes
                sense in — crafting only cares about gaining it, an affliction
                only about shedding it — which is why the label names both. */}
            <span className="field-label flex items-center gap-1.5">
              Requirement — to gain it, or to cure it
              <InfoIcon text="Mostly an adjudication reference, with one exception that makes it worth filling in: the Heal request enforces the ⬢ and the skills when removing a Status tag. Turns and Gambit stay reference-only." />
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span className="field-label">Turns</span>
                <input
                  type="number"
                  min="0"
                  value={values.requirementTurns ?? ""}
                  onChange={(e) => set("requirementTurns", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Resources</span>
                <input
                  type="number"
                  min="0"
                  value={values.requirementResources ?? ""}
                  onChange={(e) => set("requirementResources", e.target.value)}
                />
              </label>
            </div>
            <CheckField
              checked={Boolean(values.requirementGambit)}
              onChange={(e) => set("requirementGambit", e.target.checked)}
            >
              Needs a Gambit
            </CheckField>
            <span className="field-label">Skills required</span>
            <TagPicker
              tags={otherTags}
              selected={values.skillTagIds ?? []}
              onToggle={toggleSkill}
              field="id"
              emptyLabel="No tag matches that."
            />
          </section>
        </div>
      </details>
    </div>
  );
}
