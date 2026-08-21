"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  sortTagsForMenu,
  menuCategories,
  formatCost,
  costColor,
  tagsById as buildTagsById,
  unlockedTags,
} from "@/lib/characterCreation";
import { addableTags, removableTags, transferableTags, consumableTags } from "@/lib/tagRequests";
import RequestDialog from "./RequestDialog";
import PartySelect from "./PartySelect";
import InfoIcon from "./InfoIcon";
import ChipText from "./ChipText";
import { useConfirm } from "./ConfirmProvider";
import { useTags } from "./TagsProvider";
import { resolveConsumeGrants, heldSlugsOf } from "@/lib/consumeGrants";
import {
  addTagRequest,
  removeTagRequest,
  transferTagRequest,
  consumeTagRequest,
  healCharacterRequest,
} from "../(app)/character/requestActions";

// The three tag-request menus. Add Tag reuses the category-tab + selectable
// row layout from PointBuy.js, but not PointBuy itself: there's no budget, no
// tier-chain math, and no point total here, so sharing the component would
// mean threading "no economy" flags through all of it.
//
// `byId`/`heldIds` are only meaningful for the Add menu, where a tag has to
// clear its prerequisites before it can be asked for. The other three menus
// list what the character already holds, so they pass nothing and every tag
// is offered.
function TagPicker({ tags, selectedId, onSelect, byId = null, heldIds = null }) {
  const offered = useMemo(() => sortTagsForMenu(tags), [tags]);
  // Same rule as PointBuy: gate first, derive the tabs from what survived. A
  // hidden category (Demoness, Bacchus) must have no tab at all rather than
  // an empty one, which would advertise that there's something there.
  const unlocked = useMemo(
    () => (byId ? unlockedTags(offered, byId, heldIds ?? []) : offered),
    [offered, byId, heldIds],
  );
  const categories = useMemo(() => menuCategories(unlocked), [unlocked]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];
  const visible = unlocked.filter((t) => t.category === active);

  if (!unlocked.length) {
    return (
      <p className="text-sm text-muted">
        Nothing available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={c === active ? "btn" : "btn-quiet"}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2" style={{ maxHeight: "16rem", overflowY: "auto" }}>
        {visible.map((tag) => {
          const isSelected = tag.id === selectedId;
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className="panel flex w-full items-start gap-3 p-3 text-left"
              style={{
                borderLeftColor: tag.group?.color ?? undefined,
                borderLeftWidth: tag.group?.color ? 3 : undefined,
                outline: isSelected ? "1px solid var(--accent)" : undefined,
              }}
            >
              <span aria-hidden="true">{isSelected ? "◆" : "◇"}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-bold">{tag.name}</span>
                  {tag.pointCost ? (
                    <span className="text-xs" style={{ color: costColor(tag.pointCost) }}>
                      {formatCost(tag.pointCost)} pts
                    </span>
                  ) : null}
                  {tag.group?.name ? (
                    <span className="text-xs text-muted">
                      {tag.group.name}
                    </span>
                  ) : null}
                </span>
                {/* ChipText rather than RichText — the row is a <button>,
                    so a hoverable chip inside it would nest one button in
                    another. */}
                {tag.description && (
                  <ChipText
                    text={tag.description}
                    as="span"
                    className="mt-1 block text-xs text-muted"
                  />
                )}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-muted">
            Nothing available in this category.
          </p>
        )}
      </div>
    </div>
  );
}

// Only rendered for a stackable tag, so the ordinary case keeps the exact
// dialog it had. `max` is what the character holds for Remove/Transfer, and
// an open-ended cap for Add.
function QuantityField({ value, onChange, max, label }) {
  return (
    <label className="field" style={{ width: "10rem" }}>
      <span className="field-label">{label}</span>
      <input
        type="number"
        min="1"
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ResourceCostField({ value, onChange, max }) {
  return (
    <label className="field" style={{ width: "10rem" }}>
      <span className="field-label">Does this cost any resources?</span>
      <input type="number" min="0" max={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// "Paid for by" shows a name, but the dropdown speaks in keys — this maps
// back for the confirm prompt.
function payerLabel(parties, key) {
  const [kind, id] = (key ?? "").split(":");
  const pool = kind === "faction" ? parties?.factions : parties?.characters;
  const match = pool?.find((p) => p.id === id);
  if (!match) return "They";
  return kind === "faction" ? `${match.name}'s Silo` : match.name;
}

const HEAL_HELP =
  "Treating an affliction. You can only work on people standing where you " +
  "are — yourself included — and only on things your Medical training " +
  "covers. Someone has to pay for the medicine: any of you, or a faction's " +
  "Silo.";

const CONSUME_HELP =
  "Using something up. A meal becomes Ate Meal; a crate unpacks into what's " +
  "inside. It always takes one from a stack, so three meals feed you three " +
  "times. You can also just click a consumable tag on your sheet.";

export default function TagRequestButtons({
  catalog,
  characterTags,
  resources,
  otherCharacters,
  selfId,
  canHeal = false,
  healTargets = [],
  healParties = null,
  onReady,
}) {
  const [mode, setMode] = useState(null); // "add" | "remove" | "transfer" | "consume" | "heal"
  const [tagId, setTagId] = useState(null);
  const [spend, setSpend] = useState("0");
  const [quantity, setQuantity] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [patientId, setPatientId] = useState("");
  const [payerKey, setPayerKey] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const heldIds = useMemo(() => characterTags.map((ct) => ct.tagId), [characterTags]);
  const addable = useMemo(() => addableTags(catalog, heldIds), [catalog, heldIds]);
  // The catalog is purchasable-or-craftable only, so the tags that OPEN a
  // gate — Demoness, Cultist of Bacchus — aren't in it. Fold the character's
  // own held tags in, or a chain walk from a held gate tag dead-ends and the
  // category stays shut for the one person meant to see it.
  const gateById = useMemo(
    () => buildTagsById([...catalog, ...characterTags.map((ct) => ct.tag).filter(Boolean)]),
    [catalog, characterTags],
  );
  const removable = useMemo(() => removableTags(characterTags), [characterTags]);
  const transferable = useMemo(() => transferableTags(characterTags), [characterTags]);
  const consumable = useMemo(() => consumableTags(characterTags), [characterTags]);

  // The tag currently picked, in whichever menu is open. Add draws from the
  // catalog (no held count); the rest from what the character holds.
  // Heal's menus are per-patient rather than per-tag, so they sit outside the
  // `chosen` pool below — an affliction row is a summary the server built,
  // not a Tag from the catalog.
  const patient = useMemo(
    () => healTargets.find((t) => t.id === patientId) ?? null,
    [healTargets, patientId],
  );
  const affliction = useMemo(
    () => patient?.healable.find((h) => h.tagId === tagId) ?? null,
    [patient, tagId],
  );

  const chosen = useMemo(() => {
    const pool =
      mode === "add"
        ? addable
        : mode === "remove"
          ? removable
          : mode === "consume"
            ? consumable
            : mode === "heal"
              ? [] // heal's tagId is an affliction on someone else's sheet
              : transferable;
    return pool.find((t) => t.id === tagId) ?? null;
  }, [mode, tagId, addable, removable, transferable, consumable]);
  // Consume never asks how many — it always takes one — so it opts out of the
  // quantity field even for a stackable tag.
  const stacking = Boolean(chosen?.stackable) && mode !== "consume";
  const heldCount = mode === "add" ? undefined : (chosen?.quantity ?? 1);

  // Slug -> name for the "Becomes:" line. Tag.consumesInto carries slugs (a
  // repeat is how a bundle grants two of something), and the app-wide tag
  // catalog is the same source RichText's {tag:slug} references read. It
  // arrives via fetch, so fall back to the raw slug while that's in flight.
  // Filtered through the same resolver the server action uses, so the preview
  // can't promise a conditional grant this character won't get.
  const { tagsBySlug } = useTags();
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);
  const becomes = resolveConsumeGrants(chosen, heldSlugs).slugs.map(
    (slug) => tagsBySlug.get(slug)?.name ?? slug,
  );

  function pick(nextTagId) {
    setTagId(nextTagId);
    setQuantity("1");
  }

  // `presetTagId` is what lets clicking a chip on the character sheet open
  // this dialog already pointed at that tag (see TagsPanel.js).
  const open = useCallback((next, presetTagId = null) => {
    setMode(next);
    setTagId(presetTagId);
    setSpend("0");
    setQuantity("1");
    setRecipient("");
    setPatientId("");
    setPayerKey(selfId ? `character:${selfId}` : "");
    setError(null);
  }, [selfId]);

  // Hand the opener up so the chip list can drive it. `open` is stable, so
  // this fires once rather than on every render.
  useEffect(() => {
    onReady?.(open);
  }, [onReady, open]);

  // Spending someone else's ⬢ is the sharp edge here, so that — and only
  // that — asks twice. The confirm is awaited OUTSIDE startTransition: inside
  // it the dialog never renders and the button hangs on "Working...".
  async function submit(reason) {
    if (mode === "heal" && payerKey !== `character:${selfId}`) {
      const payerName = payerLabel(healParties, payerKey);
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction?.cost ?? 0} \u2b22 for this treatment.`,
        confirmLabel: "Charge them",
      });
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      // Always sent; the server pins it to 1 for a non-stackable tag anyway.
      const res =
        mode === "add"
          ? await addTagRequest({ tagId, quantity, resourcesSpent: spend, reason })
          : mode === "remove"
            ? await removeTagRequest({ tagId, quantity, resourcesSpent: spend, reason })
            : mode === "consume"
              ? await consumeTagRequest({ tagId, reason })
              : mode === "heal"
                ? await healCharacterRequest({
                    targetCharacterId: patientId,
                    tagId,
                    payerKey,
                    reason,
                  })
                : await transferTagRequest({ tagId, quantity, toCharacterId: recipient, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setMode(null);
    });
  }

  const canSubmit =
    mode === "transfer"
      ? Boolean(tagId && recipient)
      : mode === "heal"
        ? Boolean(patientId && payerKey && affliction && !affliction.missingSkills.length)
        : Boolean(tagId);
  const title =
    mode === "add"
      ? "Add Tag"
      : mode === "remove"
        ? "Remove Tag"
        : mode === "consume"
          ? "Consume Tag"
          : mode === "heal"
            ? "Heal"
            : "Transfer Tag";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-quiet" onClick={() => open("add")}>
          Add Tag
        </button>
        <button type="button" className="btn-quiet" onClick={() => open("remove")} disabled={!removable.length}>
          Remove Tag
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => open("transfer")}
          disabled={!transferable.length}
        >
          Transfer Tag
        </button>
        <span className="flex items-center gap-1">
          <button
            type="button"
            className="btn-quiet"
            onClick={() => open("consume")}
            disabled={!consumable.length}
          >
            Consume
          </button>
          <InfoIcon text={CONSUME_HELP} />
        </span>
        {canHeal && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              className="btn-quiet"
              onClick={() => open("heal")}
              disabled={!healTargets.length}
            >
              Heal
            </button>
            <InfoIcon text={HEAL_HELP} />
          </span>
        )}
      </div>

      <RequestDialog
        open={mode !== null}
        title={title}
        submitLabel={title}
        busy={pending}
        error={error}
        canSubmit={canSubmit}
        onCancel={() => !pending && setMode(null)}
        onConfirm={submit}
      >
        {mode === "add" && (
          <>
            <TagPicker
              tags={addable}
              selectedId={tagId}
              onSelect={pick}
              byId={gateById}
              heldIds={heldIds}
            />
            {stacking && (
              <QuantityField value={quantity} onChange={setQuantity} max={99} label="How many?" />
            )}
            <ResourceCostField value={spend} onChange={setSpend} max={resources} />
          </>
        )}

        {mode === "remove" && (
          <>
            <label className="field">
              <span className="field-label">Tag to remove</span>
              <select value={tagId ?? ""} onChange={(e) => pick(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {removable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.quantity > 1 ? ` \u00d7${t.quantity}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {stacking && (
              <QuantityField
                value={quantity}
                onChange={setQuantity}
                max={heldCount}
                label={`How many? (you have ${heldCount})`}
              />
            )}
            <ResourceCostField value={spend} onChange={setSpend} max={resources} />
          </>
        )}

        {mode === "consume" && (
          <>
            <label className="field">
              <span className="field-label">What are you using up?</span>
              <select value={tagId ?? ""} onChange={(e) => pick(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {consumable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.quantity > 1 ? ` \u00d7${t.quantity}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <p className="text-xs text-muted">
                {becomes.length
                  ? `Becomes: ${becomes.join(", ")}.`
                  : "Gets used up — it doesn't leave anything behind."}
                {chosen.quantity > 1 ? ` Takes one of your ${chosen.quantity}.` : ""}
              </p>
            )}
          </>
        )}

        {mode === "heal" && (
          <>
            <label className="field">
              <span className="field-label">Who are you treating?</span>
              <select
                value={patientId}
                onChange={(e) => {
                  setPatientId(e.target.value);
                  setTagId(null);
                }}
                required
              >
                <option value="" disabled>
                  Choose someone here…
                </option>
                {healTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === selfId ? `${t.name} (you)` : t.name}
                  </option>
                ))}
              </select>
            </label>
            {patient && (
              <label className="field">
                <span className="field-label">What are you treating?</span>
                <select value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)} required>
                  <option value="" disabled>
                    Choose an affliction…
                  </option>
                  {patient.healable.map((h) => (
                    <option key={h.tagId} value={h.tagId} disabled={h.missingSkills.length > 0}>
                      {h.tagName}
                      {h.missingSkills.length ? ` \u2014 needs ${h.missingSkills.join("/")}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {affliction && (
              <>
                <PartySelect
                  label="Paid for by"
                  value={payerKey}
                  onChange={setPayerKey}
                  hint="Choose who pays…"
                  characters={healParties?.characters ?? []}
                  factions={healParties?.factions ?? []}
                />
                <p className="text-xs text-muted">
                  Costs <span className="mono">{affliction.cost} ⬢</span>.
                  {affliction.requirementLabel
                    ? ` The full course of treatment is ${affliction.requirementLabel} \u2014 the turns and any Gambit are between you and a GM.`
                    : ""}
                </p>
              </>
            )}
          </>
        )}

        {mode === "transfer" && (
          <>
            <label className="field">
              <span className="field-label">Item or Asset to hand over</span>
              <select value={tagId ?? ""} onChange={(e) => pick(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {transferable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.quantity > 1 ? ` \u00d7${t.quantity}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {stacking && (
              <QuantityField
                value={quantity}
                onChange={setQuantity}
                max={heldCount}
                label={`How many? (you have ${heldCount})`}
              />
            )}
            <label className="field">
              <span className="field-label">Give it to</span>
              <select value={recipient} onChange={(e) => setRecipient(e.target.value)} required>
                <option value="" disabled>
                  Choose a player…
                </option>
                {otherCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </RequestDialog>
    </>
  );
}
