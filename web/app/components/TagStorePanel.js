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
          </div>
        </div>
      )}
    </>
  );
}
