"use client";

import { useMemo, useState } from "react";
import { purchaseTags } from "../(app)/character/actions";
import { TAG_STORE_CATEGORIES, unlockedCategoryNames } from "@/lib/tagStore";

function groupByCategory(tags) {
  const groups = new Map(TAG_STORE_CATEGORIES.map((c) => [c.name, []]));
  for (const tag of tags) {
    const category = tag.category;
    if (!groups.has(category)) continue;
    groups.get(category).push(tag);
  }
  for (const list of groups.values()) list.sort((a, b) => b.pointCost - a.pointCost);
  return groups;
}

// Groups sequential skill tags ("Cooking (Basic)", "Cooking (Skilled)", ...)
// into families ordered root-to-leaf via parentTagId, so the store can show
// one tier picker per skill instead of a checkbox per tag.
function familyName(tagName) {
  return tagName.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function buildSkillFamilies(tags) {
  const byId = new Map(tags.map((t) => [t.id, t]));
  function depth(tag) {
    let d = 0;
    let cur = tag;
    const seen = new Set();
    while (cur?.parentTagId && byId.has(cur.parentTagId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentTagId);
      d += 1;
    }
    return d;
  }

  const families = new Map();
  for (const tag of tags) {
    const name = familyName(tag.name);
    if (!families.has(name)) families.set(name, []);
    families.get(name).push(tag);
  }
  for (const tiers of families.values()) tiers.sort((a, b) => depth(a) - depth(b));
  return [...families.entries()];
}

export default function TagStorePanel({ characterId, tagPoints, ownedCharacterTags, storeTags }) {
  const [open, setOpen] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [saving, setSaving] = useState(false);

  const ownedSlugs = useMemo(
    () => new Set(ownedCharacterTags.map((ct) => ct.tag?.slug).filter(Boolean)),
    [ownedCharacterTags]
  );
  const unlockedNames = useMemo(() => new Set(unlockedCategoryNames(ownedSlugs)), [ownedSlugs]);
  const unlockedCategories = useMemo(
    () => TAG_STORE_CATEGORIES.filter((c) => unlockedNames.has(c.name)),
    [unlockedNames]
  );

  const [activeCategory, setActiveCategory] = useState(unlockedCategories[0]?.name ?? TAG_STORE_CATEGORIES[0].name);

  const storeTagIds = useMemo(() => new Set(storeTags.map((t) => t.id)), [storeTags]);
  const ownedPointBuyIds = useMemo(
    () =>
      new Set(
        ownedCharacterTags
          .filter((ct) => ct.source === "POINT_BUY" && storeTagIds.has(ct.tagId))
          .map((ct) => ct.tagId)
      ),
    [ownedCharacterTags, storeTagIds]
  );
  const lockedIds = useMemo(
    () =>
      new Set(
        ownedCharacterTags
          .filter((ct) => ct.source !== "POINT_BUY" && storeTagIds.has(ct.tagId))
          .map((ct) => ct.tagId)
      ),
    [ownedCharacterTags, storeTagIds]
  );

  const [selectedIds, setSelectedIds] = useState(ownedPointBuyIds);
  const grouped = useMemo(() => groupByCategory(storeTags), [storeTags]);
  const costById = useMemo(() => new Map(storeTags.map((t) => [t.id, t.pointCost])), [storeTags]);

  const localBalance = useMemo(() => {
    let delta = 0;
    for (const id of selectedIds) {
      if (!ownedPointBuyIds.has(id)) delta += costById.get(id) ?? 0;
    }
    for (const id of ownedPointBuyIds) {
      if (!selectedIds.has(id)) delta -= costById.get(id) ?? 0;
    }
    return tagPoints - delta;
  }, [selectedIds, ownedPointBuyIds, costById, tagPoints]);

  function openStore() {
    setSelectedIds(new Set(ownedPointBuyIds));
    setActiveCategory(unlockedCategories[0]?.name ?? TAG_STORE_CATEGORIES[0].name);
    setOpen(true);
  }

  function toggleTag(tagId) {
    if (lockedIds.has(tagId) || saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  // tierIndex -1 means "none of this family's tiers". Selecting a tier
  // replaces whichever tier (if any) was previously selected, since owning
  // both Cooking (Basic) and Cooking (Skilled) at once doesn't make sense.
  // A tier already owned via a non-point-buy grant is never added to
  // selectedIds (there's nothing to "buy") — picking it just clears any
  // other pending selection in the family, reverting to the granted tier.
  function selectTier(tiers, tierIndex) {
    if (saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const tier of tiers) next.delete(tier.id);
      if (tierIndex >= 0 && !lockedIds.has(tiers[tierIndex].id)) next.add(tiers[tierIndex].id);
      return next;
    });
  }

  async function attemptClose() {
    if (saving) return;
    if (localBalance < 0) {
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      return;
    }
    setSaving(true);
    try {
      await purchaseTags(characterId, [...selectedIds]);
      setOpen(false);
    } catch {
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn-quiet" onClick={openStore}>
          Point Buy
        </button>
        <span style={{ color: tagPoints < 0 ? "var(--accent)" : tagPoints > 0 ? "var(--mood-happy)" : "var(--muted)" }}>
          {tagPoints > 0 ? `+${tagPoints}` : tagPoints}
        </span>
      </div>

      {open && (
        <div className="modal-overlay" onClick={attemptClose}>
          <div
            className={`modal-panel${shaking ? " shake" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="font-bold">Tag Store</h2>
              <div className="flex items-center gap-3">
                <span
                  style={{
                    color: localBalance < 0 ? "var(--accent)" : localBalance > 0 ? "var(--mood-happy)" : "var(--muted)",
                  }}
                >
                  {localBalance > 0 ? `+${localBalance}` : localBalance} pts
                </span>
                <button type="button" className="btn-quiet" onClick={attemptClose} disabled={saving}>
                  Close
                </button>
              </div>
            </div>

            {localBalance < 0 && (
              <p className="text-sm mt-2" style={{ color: "var(--accent)" }}>
                You&apos;re over budget — remove tags to get back to 0 or more before closing.
              </p>
            )}

            <div className="tab-bar mt-3">
              {unlockedCategories.map((category) => (
                <button
                  key={category.name}
                  type="button"
                  className="tab-item"
                  data-active={activeCategory === category.name}
                  onClick={() => setActiveCategory(category.name)}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {(grouped.get(activeCategory) ?? []).length === 0 && (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                No tags here yet.
              </p>
            )}

            {activeCategory === "Skills" ? (
              <ul className="store-list mt-3">
                {buildSkillFamilies(grouped.get(activeCategory) ?? []).map(([family, tiers]) => {
                  // baseTierIndex is what's actually owned (any source) as of
                  // opening the store — gating is pinned to it rather than to
                  // the live selection, so you can't chain Basic -> Skilled
                  // in one visit (matching the server's same "must already
                  // own the prior tier" check, which only sees saved state).
                  let baseTierIndex = -1;
                  tiers.forEach((t, i) => {
                    if (ownedPointBuyIds.has(t.id) || lockedIds.has(t.id)) baseTierIndex = i;
                  });
                  let selectedTierIndex = -1;
                  tiers.forEach((t, i) => {
                    if (selectedIds.has(t.id) || lockedIds.has(t.id)) selectedTierIndex = i;
                  });
                  const lockedTierIndex = tiers.findIndex((t) => lockedIds.has(t.id));
                  const activeTier = selectedTierIndex >= 0 ? tiers[selectedTierIndex] : null;
                  return (
                    <li key={family} className="store-row">
                      <div className="store-row-info">
                        <p className="store-row-name">{family}</p>
                        {activeTier?.description && (
                          <p className="text-sm" style={{ color: "var(--muted)" }}>
                            {activeTier.description}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {lockedTierIndex < 0 && (
                          <button
                            type="button"
                            className="btn-quiet"
                            disabled={saving || selectedTierIndex < 0}
                            onClick={() => selectTier(tiers, -1)}
                          >
                            None
                          </button>
                        )}
                        {tiers.map((tier, i) => {
                          const selected = i === selectedTierIndex;
                          const locked = lockedIds.has(tier.id);
                          const disallowed = i > baseTierIndex + 1;
                          return (
                            <button
                              key={tier.id}
                              type="button"
                              className="btn"
                              style={selected ? { background: "var(--accent)", color: "var(--text)" } : undefined}
                              disabled={saving || disallowed || (locked && selected)}
                              onClick={() => selectTier(tiers, i)}
                              title={tier.description}
                            >
                              {tier.name.match(/\(([^)]*)\)/)?.[1] ?? tier.name}
                              {locked && selected ? " (granted)" : selected ? ` +${tier.pointCost}` : ""}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="store-list mt-3">
                {(grouped.get(activeCategory) ?? []).map((tag) => {
                  const owned = selectedIds.has(tag.id);
                  const locked = lockedIds.has(tag.id);
                  return (
                    <li key={tag.id} className="store-row">
                      <div className="store-row-info">
                        <p className="store-row-name">
                          {tag.name}
                          <span
                            style={{
                              color: tag.pointCost > 0 ? "var(--mood-happy)" : tag.pointCost < 0 ? "var(--accent)" : "var(--muted)",
                              marginLeft: "8px",
                            }}
                          >
                            {tag.pointCost > 0 ? `+${tag.pointCost}` : tag.pointCost}
                          </span>
                        </p>
                        {tag.description && (
                          <p className="text-sm" style={{ color: "var(--muted)" }}>
                            {tag.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn"
                        disabled={locked || saving}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {locked ? "Granted" : owned ? "Remove" : "Buy"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
