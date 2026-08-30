"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import {
  sortTagsForMenu,
  sortForMode,
  menuCategories,
  formatCost,
  costColor,
  filterTagsByQuery,
  tagsById as buildTagsById,
  unlockedTags,
  heldHigherTiers,
  prerequisiteNames,
  hasPrerequisite,
} from "@/lib/characterCreation";
import { addableTags, removableTags, transferableTags, consumableTags } from "@/lib/tagRequests";
import RequestDialog from "./RequestDialog";
import CheckField from "./CheckField";
import PartySelect from "./PartySelect";
import Select from "./Select";
import ChipText from "./ChipText";
import { useConfirm } from "./ConfirmProvider";
import { useTags } from "./TagsProvider";
import { heldSlugsOf } from "@/lib/consumeGrants";
import {
  addTagRequest,
  removeTagRequest,
  transferTagRequest,
  consumeTagRequest,
  healCharacterRequest,
  transferResourcesRequest,
  lootCharacterRequest,
  moveCharacterRequest,
  bindCharacterRequest,
  freeCharacterRequest,
  harmCharacterRequest,
  buryCharacterRequest,
  fastTravelRequest,
} from "../(app)/character/requestActions";

// Every player action on the character sheet, in one place: the mode state,
// the menus each mode draws from, and one RequestDialog per mode.
//
// This used to be TagRequestButtons.js, which owned both the dialogs AND the
// row of buttons that opened them, and handed its opener up to TagsPanel
// through an onReady callback so a chip click could drive Consume. That
// stopped working the moment the buttons became ActionGrid.js inside
// StatusPanel — a SIBLING above TagsPanel, not a child of it. So the state
// moved up here and both consumers read it off context, the same shape
// ConfirmProvider already uses for the same reason.
//
// The provider renders no chrome of its own. It is mounted once per sheet
// (CharacterSheet.js, self mode only) and everything visible lives in
// ActionGrid.js or in the dialogs below.

const RequestActionsContext = createContext(null);

export function useRequestActions() {
  return useContext(RequestActionsContext);
}

// --- shared field bits ----------------------------------------------------

// The tag menu. Add Tag reuses the category-tab + selectable row layout from
// PointBuy.js, but not PointBuy itself: there's no budget, no tier-chain math
// and no point total here, so sharing the component would mean threading "no
// economy" flags through all of it. Search and the tall pane ARE shared —
// filterTagsByQuery is the same matcher, so the two menus find the same
// things for the same words.
//
// `byId`/`heldIds` are only meaningful for the Add menu, where a tag has to
// clear its prerequisites before it can be asked for. The other menus list
// what somebody already holds, so they pass nothing and every tag is offered.
function TagPicker({ tags, selectedId, onSelect, byId = null, heldIds = null, emptyLabel = "Nothing available." }) {
  const [query, setQuery] = useState("");

  // The Add menu (the only caller passing byId) sorts chain-aware, so
  // Fighting's rungs read in tier order instead of scattering
  // alphabetically; the held-tag menus keep the flat cost-then-name sort.
  const offered = useMemo(
    () => (byId ? sortForMode(tags, "group", byId) : sortTagsForMenu(tags)),
    [tags, byId],
  );
  // Same rule as PointBuy: gate first, derive the tabs from what survived. A
  // hidden category (Demoness, Bacchus) must have no tab at all rather than
  // an empty one, which would advertise that there's something there.
  const unlocked = useMemo(
    () => (byId ? unlockedTags(offered, byId, heldIds ?? []) : offered),
    [offered, byId, heldIds],
  );
  // "Unlocked by your tags", same as PointBuy's checkbox: everything shown
  // already passed the gates, so gated-and-shown means gated-and-met.
  const [requiresOnly, setRequiresOnly] = useState(false);
  const gated = useMemo(
    () => (byId && requiresOnly ? unlocked.filter(hasPrerequisite) : unlocked),
    [unlocked, byId, requiresOnly],
  );
  const pool = useMemo(() => filterTagsByQuery(gated, query), [gated, query]);
  const categories = useMemo(() => menuCategories(pool), [pool]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];
  const visible = pool.filter((t) => t.category === active);

  if (!unlocked.length) return <p className="text-sm text-muted">{emptyLabel}</p>;

  return (
    <div className="flex flex-col gap-3">
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
        {byId && (
          <CheckField
            checked={requiresOnly}
            onChange={(e) => setRequiresOnly(e.target.checked)}
            className="pb-2"
          >
            Unlocked by your tags
          </CheckField>
        )}
      </div>

      {categories.length > 1 && (
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
      )}

      {/* Was 16rem, which showed three rows of a catalog this size. The pane
          scrolls itself rather than growing the dialog, so the reason field
          and the Confirm button stay reachable however long Items gets —
          the same treatment PointBuy.js gives its own catalog. */}
      <div className="flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: "60vh" }}>
        {visible.map((tag) => {
          const isSelected = tag.id === selectedId;
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className="select-card panel flex w-full items-start gap-3 p-3 text-left"
              style={{
                borderLeftColor: tag.group?.color ?? undefined,
                borderLeftWidth: tag.group?.color ? 3 : undefined,
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
                  {tag.group?.name ? <span className="text-xs text-muted">{tag.group.name}</span> : null}
                </span>
                {/* ChipText rather than RichText — the row is a <button>, so a
                    hoverable chip inside it would nest one button in another. */}
                {tag.description && (
                  <ChipText text={tag.description} as="span" className="mt-1 block text-xs text-muted" />
                )}
                {/* The gate that unlocked this row — role/faction kit would
                    otherwise be indistinguishable from the open catalog.
                    Only qualifying viewers ever see the row. */}
                {prerequisiteNames(tag).length > 0 && (
                  <span className="mt-1 block text-xs" style={{ color: "var(--accent-text)" }}>
                    Requires: {prerequisiteNames(tag).join(", ")}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-muted">
            {query ? "Nothing matches that." : "Nothing available in this category."}
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
      <input type="number" min="1" max={max} value={value} onChange={(e) => onChange(e.target.value)} />
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

// A "nobody here qualifies" line, used by every action whose targets are other
// people. It is never used to HIDE the action — see ActionGrid.js on why a
// greyed-out button would itself be the leak.
function NobodyHere({ children }) {
  return <p className="text-sm text-muted">{children}</p>;
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

// --- copy -----------------------------------------------------------------

export const ACTION_HELP = {
  add:
    "To save the GMs time, you can add or remove tags at will, but you're " +
    "expected to subtract the appropriate amount of resources / spend the " +
    "amount of turns. They'll review the action later, but it'll push " +
    "immediately.",
  heal: "Works on others nearby too. Gated by your Medical skill.",
  consume: "Use something up. You can also just click on the tag on your sheet.",
  loot: "Search someone. Only works on Bound, Dying, or Catatonic people.",
  move:
    "Forcibly move someone with the Bound tag. Use this before changing zones " +
    "yourself. If you're a Leader, you can also move people within your own " +
    "faction. It does not spend their turn. Bodies can be dragged by anyone.",
  bind: "Tie up anyone standing where you are. Once they're Bound you can loot them or march them somewhere.",
  free: "Cut someone loose. Anyone standing here can do this, including a rescuer.",
  harm: "Further injure someone who is bound or incapacitated.",
  bury:
    "Put a body that lies where you are into the ground. It lays the soul to " +
    "rest and lifts the curse from the player it belonged to, so they can " +
    "roll a full character again. Type their first name — there is no list.",
  fasttravel:
    "Ride to a neighbouring zone without spending your turn. Once a day, and " +
    "everyone sees you go.",
  resources: (
    <>
      <p>Both ends have to be within reach of you.</p>
      <p>
        <strong>To a person</strong> Be in the same zone.
      </p>
      <p>
        <strong>To or from a Silo</strong> Be in the faction&apos;s zone.
      </p>
    </>
  ),
};

const TITLES = {
  add: "Add Tag",
  remove: "Remove Tag",
  transfer: "Transfer Tag",
  consume: "Consume Tag",
  heal: "Heal",
  resources: "Transfer Resources",
  loot: "Loot",
  move: "Move Player",
  bind: "Bind",
  free: "Free",
  harm: "Harm",
  bury: "Bury Person",
  fasttravel: "Fast Travel",
};

// Why a given person is lootable, for the target list. The living cases are
// the INCAPACITATING_SLUGS set (db/lib/incapacitation.js) turned into prose by
// the server; a corpse says so plainly.
function targetNote(t) {
  if (t.status === "DEAD") return "Dead";
  return t.condition ?? "Helpless";
}

export default function RequestActionsProvider({
  children,
  // False on someone else's sheet. The hooks below still run — they have to,
  // unconditionally — but no context and no dialog are handed down, so
  // TagsPanel's `useRequestActions()?.open` comes back null and its chips stay
  // the read-only hover tooltips they are for a viewer.
  enabled = true,
  selfId,
  selfName,
  catalog = [],
  characterTags = [],
  resources = 0,
  otherCharacters = [],
  transferParties = null,
  canHeal = false,
  healTargets = [],
  healParties = null,
  // Everyone in this zone worth acting on. Built once in character/page.js so
  // the four target menus below can't disagree about who is standing here.
  lootTargets = [],
  moveTargets = [],
  moveZones = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  canFastTravel = false,
}) {
  const [mode, setMode] = useState(null);
  const [tagId, setTagId] = useState(null);
  const [spend, setSpend] = useState("0");
  const [quantity, setQuantity] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [patientId, setPatientId] = useState("");
  const [payerKey, setPayerKey] = useState("");
  const [targetId, setTargetId] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [amount, setAmount] = useState("1");
  // tagId -> quantity string, for the multi-take Loot dialog. Always replaced
  // wholesale, never mutated (react-hooks/immutability is an error here).
  const [picks, setPicks] = useState({});
  const [zoneId, setZoneId] = useState("");
  const [lethal, setLethal] = useState(false);
  // Bury is the only request that types its target instead of picking it —
  // a dropdown here would be a list of the dead. See REQUESTS.md §5d.
  const [buryName, setBuryName] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const heldIds = useMemo(() => characterTags.map((ct) => ct.tagId), [characterTags]);
  // The catalog is purchasable-or-craftable only, so the tags that OPEN a
  // gate — Demoness, Cultist of Bacchus — aren't in it. Fold the character's
  // own held tags in, or a chain walk from a held gate tag dead-ends and the
  // category stays shut for the one person meant to see it.
  const gateById = useMemo(
    () => buildTagsById([...catalog, ...characterTags.map((ct) => ct.tag).filter(Boolean)]),
    [catalog, characterTags],
  );
  // heldHigherTiers hides the rungs BELOW a held chain tier — a chain
  // replaces upward and never re-opens downward. addTagRequest rejects the
  // same thing server-side.
  const addable = useMemo(
    () => addableTags(catalog, heldIds).filter((t) => heldHigherTiers(t, gateById, heldIds).length === 0),
    [catalog, heldIds, gateById],
  );
  const removable = useMemo(() => removableTags(characterTags), [characterTags]);
  const transferable = useMemo(() => transferableTags(characterTags), [characterTags]);
  const consumable = useMemo(() => consumableTags(characterTags), [characterTags]);

  // Heal's menus are per-patient rather than per-tag, so they sit outside the
  // `chosen` pool below — an affliction row is a summary the server built, not
  // a Tag from the catalog.
  const patient = useMemo(() => healTargets.find((t) => t.id === patientId) ?? null, [healTargets, patientId]);
  const affliction = useMemo(
    () => patient?.healable.find((h) => h.tagId === tagId) ?? null,
    [patient, tagId],
  );
  const lootTarget = useMemo(() => lootTargets.find((t) => t.id === targetId) ?? null, [lootTargets, targetId]);
  // Bind and Free share one co-located roster and split it on who is already
  // tied up, so the two menus can never disagree about the same person.
  const bindable = useMemo(
    () => bindTargets.filter((t) => (mode === "bind" ? !t.bound : t.bound)),
    [bindTargets, mode],
  );

  const chosen = useMemo(() => {
    // heal's tagId is an affliction on someone else's sheet, and harm's is a
    // catalog injury — neither is a tag this character holds, so both opt out.
    const pool =
      mode === "add"
        ? addable
        : mode === "remove"
          ? removable
          : mode === "consume"
            ? consumable
            : mode === "heal" || mode === "harm"
              ? []
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
  //
  // A consumesIntoOneOf position (Skinned Cave Rat -> Ate Meal or Vomiting) is
  // NOT resolved through resolveConsumeGrants here — that rolls a real pick,
  // and calling it on every render would make the preview commit to (and
  // re-roll) an outcome nobody chose yet. It's rendered as "A or B" instead,
  // off the raw sidecar, so the preview stays honest.
  const { tagsBySlug } = useTags();
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);
  const nameOf = (slug) => tagsBySlug.get(slug)?.name ?? slug;
  const becomes = (chosen?.consumesInto ?? [])
    .map((slug, i) => {
      const blockers = chosen?.consumesIntoUnless?.[slug] ?? null;
      if (blockers?.some((b) => heldSlugs.has(b))) return null;
      const alternatives = chosen?.consumesIntoOneOf?.[i];
      return Array.isArray(alternatives) ? alternatives.map(nameOf).join(" or ") : nameOf(slug);
    })
    .filter(Boolean);

  function pick(nextTagId) {
    setTagId(nextTagId);
    setQuantity("1");
  }

  // Loot takes a mix, so its picks are a checkbox set rather than one choice.
  function togglePick(id, held) {
    setPicks((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = String(Math.min(1, held) || 1);
      return next;
    });
  }
  function setPickQuantity(id, value) {
    setPicks((prev) => ({ ...prev, [id]: value }));
  }

  // `presetTagId` is what lets clicking a chip on the character sheet open
  // this dialog already pointed at that tag (see TagsPanel.js).
  const open = useCallback(
    (next, presetTagId = null) => {
      setMode(next);
      setTagId(presetTagId);
      setSpend("0");
      setQuantity("1");
      setRecipient("");
      setPatientId("");
      setPayerKey(selfId ? `character:${selfId}` : "");
      setTargetId("");
      setFromKey(selfId ? `character:${selfId}` : "");
      setToKey("");
      setAmount("1");
      setPicks({});
      setZoneId("");
      setLethal(false);
      setBuryName("");
      setError(null);
    },
    [selfId],
  );

  // Spending someone else's ⬢ is the sharp edge in Heal, and Harm's lethal
  // branch is the sharp edge everywhere else — so those two, and only those
  // two, ask twice. The confirm is awaited OUTSIDE startTransition: inside it
  // the dialog never renders and the button hangs on "Working...".
  async function submit(reason) {
    if (mode === "heal" && payerKey !== `character:${selfId}`) {
      const payerName = payerLabel(healParties, payerKey);
      const ok = await confirm({
        title: "Bill someone else?",
        message: `${payerName} will be charged ${affliction?.cost ?? 0} ⬢ for this treatment.`,
        confirmLabel: "Charge them",
      });
      if (!ok) return;
    }
    if (mode === "harm" && lethal) {
      const name = harmTargets.find((t) => t.id === targetId)?.name ?? "them";
      const ok = await confirm({
        title: "Finish them off?",
        message: `This asks a GM to kill ${name} for good. It doesn't kill them by itself.`,
        confirmLabel: "Ask for the kill",
      });
      if (!ok) return;
    }

    setError(null);
    startTransition(async () => {
      const res = await runAction(reason);
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setMode(null);
    });
  }

  function runAction(reason) {
    switch (mode) {
      case "add":
        // Always sent; the server pins it to 1 for a non-stackable tag anyway.
        return addTagRequest({ tagId, quantity, resourcesSpent: spend, reason });
      case "remove":
        return removeTagRequest({ tagId, quantity, resourcesSpent: spend, reason });
      case "consume":
        return consumeTagRequest({ tagId, reason });
      case "heal":
        return healCharacterRequest({ targetCharacterId: patientId, tagId, payerKey, reason });
      case "transfer":
        return transferTagRequest({ tagId, quantity, toCharacterId: recipient, reason });
      case "resources":
        return transferResourcesRequest({ fromKey, toKey, amount, reason });
      case "loot":
        return lootCharacterRequest({
          targetCharacterId: targetId,
          tagPicks: Object.entries(picks).map(([id, q]) => ({ tagId: id, quantity: q })),
          amount,
          reason,
        });
      case "move":
        return moveCharacterRequest({ targetCharacterId: targetId, targetZoneId: zoneId, reason });
      case "bind":
        return bindCharacterRequest({ targetCharacterId: targetId, reason });
      case "free":
        return freeCharacterRequest({ targetCharacterId: targetId, reason });
      case "harm":
        return harmCharacterRequest({ targetCharacterId: targetId, tagId, lethal, reason });
      case "bury":
        return buryCharacterRequest({ firstName: buryName, reason });
      case "fasttravel":
        return fastTravelRequest({ targetZoneId: zoneId, reason });
      default:
        return Promise.resolve({ ok: false, error: "Nothing to do." });
    }
  }

  const sameParty = fromKey && fromKey === toKey;
  const takingSomething = Object.keys(picks).length > 0 || Number(amount) > 0;

  const canSubmit = (() => {
    switch (mode) {
      case "transfer":
        return Boolean(tagId && recipient);
      case "heal":
        return Boolean(patientId && payerKey && affliction && !affliction.missingSkills.length);
      case "resources":
        return Boolean(fromKey && toKey && !sameParty);
      case "loot":
        return Boolean(targetId && takingSomething);
      case "move":
        return Boolean(targetId && zoneId);
      case "bind":
      case "free":
        return Boolean(targetId);
      case "harm":
        return Boolean(targetId && (tagId || lethal));
      case "bury":
        return Boolean(buryName.trim());
      case "fasttravel":
        return Boolean(zoneId);
      default:
        return Boolean(tagId);
    }
  })();

  // What the grid needs to grey a button out. ONLY facts about this
  // character's own sheet appear here — see ActionGrid.js.
  const pools = useMemo(
    () => ({
      canAdd: addable.length > 0,
      canRemove: removable.length > 0,
      canTransfer: transferable.length > 0,
      canConsume: consumable.length > 0,
      canHeal,
      canFastTravel,
    }),
    [addable, removable, transferable, consumable, canHeal, canFastTravel],
  );

  const value = useMemo(() => (enabled ? { open, pools } : null), [enabled, open, pools]);

  const title = TITLES[mode] ?? "Request";
  const dialogWidth = mode === "add" || mode === "harm" || mode === "loot" ? "wide" : undefined;

  return (
    <RequestActionsContext.Provider value={value}>
      {children}

      {enabled && (
      <RequestDialog
        open={mode !== null}
        title={title}
        submitLabel={title}
        width={dialogWidth}
        busy={pending}
        error={error}
        canSubmit={canSubmit}
        onCancel={() => !pending && setMode(null)}
        onConfirm={submit}
      >
        {mode === "add" && (
          <>
            <TagPicker tags={addable} selectedId={tagId} onSelect={pick} byId={gateById} heldIds={heldIds} />
            {stacking && <QuantityField value={quantity} onChange={setQuantity} max={99} label="How many?" />}
            {chosen?.requirementTurns === 0 &&
              (chosen.requirementSkills ?? []).some((s) => /^(Smithing|Crafting)/.test(s.name ?? "")) && (
                // Mirrors web/lib/requests.js#isDeadSimple (server-enforced);
                // that module can't be imported here without dragging Prisma in.
                <p className="text-sm text-muted">Dead Simple recipes: up to 4 items per turn, counted across your requests.</p>
              )}
            <ResourceCostField value={spend} onChange={setSpend} max={resources} />
          </>
        )}

        {mode === "remove" && (
          <>
            <label className="field">
              <span className="field-label">Tag to remove</span>
              <Select value={tagId ?? ""} onChange={(e) => pick(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {removable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                  </option>
                ))}
              </Select>
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
              <Select value={tagId ?? ""} onChange={(e) => pick(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {consumable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                  </option>
                ))}
              </Select>
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
              <Select
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
              </Select>
            </label>
            {patient && (
              <label className="field">
                <span className="field-label">What are you treating?</span>
                <Select value={tagId ?? ""} onChange={(e) => setTagId(e.target.value || null)} required>
                  <option value="" disabled>
                    Choose an affliction…
                  </option>
                  {patient.healable.map((h) => (
                    <option key={h.tagId} value={h.tagId} disabled={h.missingSkills.length > 0}>
                      {h.tagName}
                      {h.missingSkills.length ? ` — needs ${h.missingSkills.join("/")}` : ""}
                    </option>
                  ))}
                </Select>
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
                    ? ` The full course of treatment is ${affliction.requirementLabel} — the turns and any Gambit are between you and a GM.`
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
              <Select value={tagId ?? ""} onChange={(e) => pick(e.target.value || null)} required>
                <option value="" disabled>
                  Choose a tag…
                </option>
                {transferable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                  </option>
                ))}
              </Select>
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
              <Select value={recipient} onChange={(e) => setRecipient(e.target.value)} required>
                <option value="" disabled>
                  Choose a player…
                </option>
                {otherCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}

        {mode === "resources" && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <PartySelect
                label="From"
                value={fromKey}
                onChange={setFromKey}
                hint="Choose a source…"
                characters={transferParties?.characters ?? []}
                factions={transferParties?.factions ?? []}
              />
              <PartySelect
                label="To"
                value={toKey}
                onChange={setToKey}
                hint="Choose a recipient…"
                characters={transferParties?.characters ?? []}
                factions={transferParties?.factions ?? []}
              />
              <label className="field" style={{ width: "6rem" }}>
                <span className="field-label">Amount</span>
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
            </div>
            {sameParty && <p className="text-xs text-accent">Source and recipient are the same.</p>}
            <p className="text-xs text-muted">
              Both the source and the recipient have to share a zone. Say why in the reason above.
              {selfName ? ` You are ${selfName}.` : ""}
            </p>
          </>
        )}

        {mode === "loot" && (
          <>
            {lootTargets.length === 0 ? (
              <NobodyHere>Nobody here is in any state to be searched.</NobodyHere>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Who are you searching?</span>
                  <Select
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      setPicks({});
                      setAmount("0");
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose someone here…
                    </option>
                    {lootTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {targetNote(t)}
                      </option>
                    ))}
                  </Select>
                </label>

                {lootTarget && (
                  <>
                    {lootTarget.tags.length === 0 ? (
                      <p className="text-xs text-muted">They&apos;re carrying nothing worth taking.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="field-label">Take</span>
                        {lootTarget.tags.map((t) => {
                          const checked = t.tagId in picks;
                          return (
                            <div key={t.tagId} className="flex flex-wrap items-center gap-3">
                              <CheckField
                                checked={checked}
                                onChange={() => togglePick(t.tagId, t.quantity)}
                              >
                                {t.tagName}
                                {t.quantity > 1 ? ` ×${t.quantity}` : ""}
                              </CheckField>
                              {checked && t.stackable && t.quantity > 1 && (
                                <label className="field" style={{ width: "7rem" }}>
                                  <span className="field-label">How many?</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max={t.quantity}
                                    value={picks[t.tagId]}
                                    onChange={(e) => setPickQuantity(t.tagId, e.target.value)}
                                  />
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <label className="field" style={{ width: "10rem" }}>
                      <span className="field-label">
                        Resources (they have {lootTarget.resources})
                      </span>
                      <input
                        type="number"
                        min="0"
                        max={lootTarget.resources}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </>
            )}
          </>
        )}

        {mode === "move" && (
          <>
            {moveTargets.length === 0 ? (
              <NobodyHere>There&apos;s nobody here to move.</NobodyHere>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Who are you moving?</span>
                  <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                    <option value="" disabled>
                      Choose someone here…
                    </option>
                    {moveTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.status === "DEAD" ? " — body" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span className="field-label">Where to?</span>
                  <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
                    <option value="" disabled>
                      Choose a neighbouring zone…
                    </option>
                    {moveZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <p className="text-xs text-muted">
                  You can move someone you lead, someone you&apos;ve bound, or a body. It does not spend
                  their turn — and it does not move you, so go there yourself afterwards.
                </p>
              </>
            )}
          </>
        )}

        {mode === "bury" && (
          <>
            <label className="field">
              <span className="field-label">Whose body?</span>
              <input
                type="text"
                value={buryName}
                onChange={(e) => setBuryName(e.target.value)}
                placeholder="First name"
                autoComplete="off"
                maxLength={24}
                required
              />
            </label>
            {/* No target list, and no "nobody here" line either — both would
                answer "who is dead in this room?" without anyone choosing to
                ask. You type a name and find out whether you were right. */}
            <p className="text-xs text-muted">
              Their first name only, spelled the way they spell it. The body has to be lying where
              you are. Burying lays the soul to rest and lifts the curse from the player it belonged
              to, so they can roll a full character again.
            </p>
          </>
        )}

        {mode === "fasttravel" && (
          <>
            <label className="field">
              <span className="field-label">Where are you riding?</span>
              <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
                <option value="" disabled>
                  Choose a neighbouring zone…
                </option>
                {moveZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            </label>
            <p className="text-xs text-muted">
              One zone over, and it does not spend your turn — you can still act when you arrive.
              Your horse will carry you once a day. Everyone sees you ride.
            </p>
          </>
        )}

        {(mode === "bind" || mode === "free") && (
          <>
            {bindable.length === 0 ? (
              <NobodyHere>
                {mode === "bind"
                  ? "There’s nobody here left to tie up."
                  : "Nobody here is bound."}
              </NobodyHere>
            ) : (
              <label className="field">
                <span className="field-label">
                  {mode === "bind" ? "Who are you tying up?" : "Who are you cutting loose?"}
                </span>
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="" disabled>
                    Choose someone here…
                  </option>
                  {bindable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <p className="text-xs text-muted">
              {mode === "bind"
                ? "Once they're Bound you can search them or march them somewhere. Say why."
                : "Anyone standing here can do this, including someone who came to rescue them."}
            </p>
          </>
        )}

        {mode === "harm" && (
          <>
            {harmTargets.length === 0 ? (
              <NobodyHere>Nobody here is helpless enough for that.</NobodyHere>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">Who are you hurting?</span>
                  <Select
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      setLethal(false);
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose someone here…
                    </option>
                    {harmTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.condition ?? "Helpless"}
                      </option>
                    ))}
                  </Select>
                </label>

                <span className="field-label">What injury? (optional)</span>
                <TagPicker
                  tags={harmTags}
                  selectedId={tagId}
                  onSelect={setTagId}
                  emptyLabel="No injuries in the catalog."
                />

                <CheckField
                  checked={lethal}
                  onChange={(e) => setLethal(e.target.checked)}
                  disabled={!harmTargets.find((t) => t.id === targetId)?.finishable}
                >
                  Finish them off
                </CheckField>
                <p className="text-xs text-muted">
                  Only someone Dying or Bound can be finished off, and doing it does <strong>not</strong>{" "}
                  kill them — it asks a GM to. Pick an injury, tick the box, or both.
                </p>
              </>
            )}
          </>
        )}
      </RequestDialog>
      )}
    </RequestActionsContext.Provider>
  );
}
