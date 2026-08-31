"use client";

import { useMemo } from "react";
import Modal from "@/app/components/Modal";
import ChipText from "@/app/components/ChipText";
import ChipLabel from "@/app/components/ChipLabel";
import { formatCost, costColor } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";

// The read-only detail sheet behind a row click on the Tag Catalog: the full
// description plus everything the table can't fit — the tier chain, the
// prerequisite links, group siblings, and what the tag consumes or decays
// into. Every related tag is a button that re-opens the sheet on it, so a
// chain can be walked without touching the table.
//
// Read-only on purpose, YAML row or not: this is the designer's reading
// view. Editing stays where it was — the pencil for custom tags, the YAML
// for everything else.

// Tag.expiresInto / Tag.removesInto entries are normalised to
// { oneOf: [...] } by db/lib/syncTags.js — same rendering TagChip gives them.
function chainTokens(chain) {
  const entries = Array.isArray(chain) ? chain : null;
  if (!entries?.length) return null;
  return entries
    .map((entry) => (entry?.oneOf ?? []).map((slug) => `{tag:${slug}}`).join(" or "))
    .filter(Boolean)
    .join(" and ");
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// `tags` (see page.js) ships a flattened `groupColor`, not the `group.color`
// TagChip/ChipLabel expect — the detail sheet's rows are hand-picked columns,
// not a full Tag row. This adapts it rather than widening that query, since
// nothing else here needs the rest of the group relation.
function withGroupColor(tag) {
  return { name: tag.name, group: tag.groupColor ? { color: tag.groupColor } : null };
}

function TagButton({ tag, onOpen }) {
  return (
    <button type="button" className="btn-quiet" onClick={() => onOpen(tag)}>
      <ChipLabel tag={withGroupColor(tag)} />
    </button>
  );
}

const FLAG_LABELS = [
  ["purchasable", "Purchasable"],
  ["purchasableAfterStart", "After-start"],
  ["craftable", "Craftable"],
  ["stackable", "Stackable"],
  ["equippable", "Equippable"],
  ["concealsIdentity", "Conceals identity"],
  ["consumable", "Consumable"],
  ["removable", "Removable"],
  ["tradeable", "Tradeable"],
];

// Tag.inspectVisibility isn't a flag, so it can't ride in FLAG_LABELS — but it
// belongs in the same chip row, since a reader scanning for "who can see this"
// shouldn't have to look in two places. HIDDEN renders nothing, same as an
// unset flag.
const VISIBILITY_CHIP = {
  ALWAYS: "Visible on 🔍",
  WORN: "Visible on 🔍 while worn",
};

export default function TagDetailSheet({ tag, tags, onOpen, onClose }) {
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const bySlug = useMemo(() => new Map(tags.map((t) => [t.slug, t])), [tags]);

  // Ancestors up the parentTag chain (closest first), children back down.
  const ancestors = useMemo(() => {
    const out = [];
    const seen = new Set([tag.id]);
    let current = tag.parentTagId ? byId.get(tag.parentTagId) : null;
    while (current && !seen.has(current.id)) {
      out.push(current);
      seen.add(current.id);
      current = current.parentTagId ? byId.get(current.parentTagId) : null;
    }
    return out;
  }, [tag, byId]);
  const children = useMemo(
    () => tags.filter((t) => t.parentTagId === tag.id),
    [tags, tag.id],
  );

  const requiredTag = tag.requiredTagId ? byId.get(tag.requiredTagId) : null;
  const prerequisiteFor = useMemo(
    () => tags.filter((t) => t.requiredTagId === tag.id),
    [tags, tag.id],
  );
  const siblings = useMemo(
    () => (tag.groupId ? tags.filter((t) => t.groupId === tag.groupId && t.id !== tag.id) : []),
    [tags, tag.groupId, tag.id],
  );

  const consumesInto = (tag.consumesInto ?? [])
    .map((slug) => bySlug.get(slug))
    .filter(Boolean);
  const becomes = chainTokens(tag.expiresInto);
  const treated = chainTokens(tag.removesInto);
  const flags = [
    ...FLAG_LABELS.filter(([key]) => tag[key]).map(([, label]) => label),
    VISIBILITY_CHIP[tag.inspectVisibility],
  ].filter(Boolean);
  const requirement = formatTagRequirement(tag);

  return (
    <Modal panelClassName="doc-sheet" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title flex items-center gap-2">
              <ChipLabel tag={withGroupColor(tag)} />
              <span className="text-base" style={{ color: costColor(tag.pointCost) }}>
                {formatCost(tag.pointCost)}
              </span>
            </h2>
            <p className="mono text-xs text-muted">
              {tag.slug} · {tag.category}
              {tag.groupName ? ` · ${tag.groupName}` : ""} · {tag.custom ? "GM-created" : "docs/tags.yaml"}
            </p>
          </div>
          <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flags.map((label) => (
              <span key={label} className="chip">
                {label}
              </span>
            ))}
          </div>
        )}

        {tag.description ? (
          <ChipText text={tag.description} className="text-sm" />
        ) : (
          <p className="text-sm text-muted">No description yet — a stub awaiting prose.</p>
        )}

        <div className="flex flex-col gap-2">
          {requirement && <Row label="To acquire">{requirement}</Row>}
          {tag.defaultDurationTurns != null && (
            <Row label="Lasts">
              {tag.defaultDurationTurns} turn{tag.defaultDurationTurns === 1 ? "" : "s"}
            </Row>
          )}
          {becomes && (
            <Row label="Becomes">
              <ChipText text={becomes} as="span" />
            </Row>
          )}
          {treated && (
            <Row label="Treated">
              <ChipText text={treated} as="span" />
            </Row>
          )}
          {(ancestors.length > 0 || children.length > 0) && (
            <Row label="Chain">
              <span className="flex flex-wrap items-center gap-1">
                {[...ancestors].reverse().map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
                {ancestors.length > 0 && <span aria-hidden="true">→</span>}
                <span className="chip" aria-current="true">
                  <strong>{tag.name}</strong>
                </span>
                {children.length > 0 && <span aria-hidden="true">→</span>}
                {children.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {requiredTag && (
            <Row label="Requires">
              <TagButton tag={requiredTag} onOpen={onOpen} />
            </Row>
          )}
          {prerequisiteFor.length > 0 && (
            <Row label="Unlocks">
              <span className="flex flex-wrap gap-1">
                {prerequisiteFor.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {consumesInto.length > 0 && (
            <Row label="Consumes into">
              <span className="flex flex-wrap gap-1">
                {consumesInto.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {siblings.length > 0 && (
            <Row label={`${tag.groupName ?? "Group"} peers`}>
              <span className="flex flex-wrap gap-1">
                {siblings.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          <Row label="Held by">{tag.held ? `${tag.held} character${tag.held === 1 ? "" : "s"}` : "Nobody"}</Row>
        </div>
      </div>
    </Modal>
  );
}
