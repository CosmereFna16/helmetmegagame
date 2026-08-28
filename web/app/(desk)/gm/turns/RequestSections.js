"use client";

import CheckField from "@/app/components/CheckField";
import CharacterLink from "@/app/components/CharacterLink";
import TagChip from "@/app/components/TagChip";
import { useTags } from "@/app/components/TagsProvider";

// The per-type bottom half of a Request review, extracted verbatim from the
// old RequestPanel so the desk renders the same controls. Adding a
// RequestType means adding one entry here and one to REQUEST_EFFECTS in
// web/lib/requestEffects.js — nothing else changes.

function Line({ label, children }) {
  return (
    <p className="text-sm">
      <span className="field-label" style={{ marginRight: 8 }}>
        {label}
      </span>
      {children}
    </p>
  );
}

function SpendField({ value, onChange }) {
  return (
    <label className="field" style={{ width: "12rem" }}>
      <span className="field-label">Resources spent</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function BloodField({ value, onChange }) {
  return (
    <label className="field" style={{ width: "12rem" }}>
      <span className="field-label">Blood added</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// "Fine Meal x3" for a stack, a plain name otherwise. Reads the count off
// `effect`, never off live state — same rule as Undo (REQUESTS.md §2).
function stackLabel(effect) {
  const name = effect.tagName ?? "—";
  return (effect.quantity ?? 1) > 1 ? `${name} ×${effect.quantity}` : name;
}

// A hoverable TagChip when `effect.tagId` still resolves against the live
// catalog, falling back to the plain snapshot name when it doesn't (the tag
// was deleted since the request was filed — the snapshot is exactly what
// Undo would still put back, so the text stays truthful even then).
function TagStack({ effect, tagsById }) {
  const tag = effect.tagId ? tagsById?.get(effect.tagId) : null;
  if (!tag) return stackLabel(effect);
  return <TagChip tag={tag} quantity={effect.quantity ?? 1} />;
}

// CONSUME_TAG's "Became" line — several tags at once (`granted`), each
// resolved the same way TagStack resolves the one it consumed.
function GrantedList({ granted, tagsById }) {
  const items = (granted ?? []).filter((g) => g.added > 0);
  if (!items.length) return "—";
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((g) => {
        const tag = g.tagId ? tagsById?.get(g.tagId) : null;
        return tag ? (
          <TagChip key={g.tagId} tag={tag} quantity={g.added} />
        ) : (
          <span key={g.tagId ?? g.tagName}>{g.added > 1 ? `${g.tagName} ×${g.added}` : g.tagName}</span>
        );
      })}
    </span>
  );
}

export const SECTIONS = {
  FULFILL_DESIRE: {
    heading: "Fulfill Desire",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Desire">{effect.desireText ?? "—"}</Line>
        <Line label="Player claimed">
          {effect.playerClaimedPoints ?? effect.pointsAwarded ?? 0} Tag Points
          {effect.playerClaimedPoints != null && (
            <span className="text-muted"> — now {effect.pointsAwarded ?? 0}</span>
          )}
        </Line>
        <label className="field" style={{ width: "12rem" }}>
          <span className="field-label">Tag Points awarded</span>
          <input
            type="number"
            min="0"
            value={edits.pointsAwarded}
            onChange={(e) => setEdit("pointsAwarded", e.target.value)}
          />
        </label>
      </>
    ),
  },

  ADD_TAG: {
    heading: "Add Tag",
    render: ({ effect, edits, setEdit, tagsById }) => (
      <>
        <Line label="Tag added">
          <TagStack effect={effect} tagsById={tagsById} />
        </Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <CheckField
          checked={Boolean(edits.removeTag)}
          onChange={(e) => setEdit("removeTag", e.target.checked)}
        >
          Remove what this request added, but keep the resource cost
        </CheckField>
      </>
    ),
  },

  BUY_TAGS: {
    heading: "Store Purchase",
    render: ({ effect, tagsById }) => (
      <>
        {(effect.items ?? []).map((item) => {
          const tag = item.tagId ? tagsById?.get(item.tagId) : null;
          return (
            <Line key={item.tagId} label={tag ? <TagChip tag={tag} /> : item.tagName}>
              {item.cost} pt{item.cost === 1 ? "" : "s"}
            </Line>
          );
        })}
        <Line label="Total">{effect.totalPoints ?? 0} Tag Points</Line>
        <p className="text-xs text-muted">
          Undo returns every tag in the cart and refunds the points.
        </p>
      </>
    ),
  },

  REMOVE_TAG: {
    heading: "Remove Tag",
    render: ({ effect, edits, setEdit, tagsById }) => (
      <>
        <Line label="Tag removed">
          <TagStack effect={effect} tagsById={tagsById} />
        </Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <p className="text-xs text-muted">
          Undo puts the tag back with its original source and expiry, and refunds the cost.
        </p>
      </>
    ),
  },

  CONSUME_TAG: {
    heading: "Consume Tag",
    render: ({ effect, tagsById }) => (
      <>
        <Line label="Consumed">
          <TagStack effect={effect} tagsById={tagsById} />
        </Line>
        <Line label="Became">
          <GrantedList granted={effect.granted} tagsById={tagsById} />
        </Line>
        <p className="text-xs text-muted">
          Nothing to re-score here.
        </p>
      </>
    ),
  },

  TRANSFER_RESOURCES: {
    heading: "Transfer Resources",
    render: ({ effect }) => (
      <>
        <Line label="Moved">
          {effect.amount} ⬢ from {effect.from?.name ?? "?"} to {effect.to?.name ?? "?"}
        </Line>
        <p className="text-xs text-muted">
          Nothing to edit here — either it stands or you reverse it.
        </p>
      </>
    ),
  },

  TRANSFER_TAG: {
    heading: "Transfer Tag",
    render: ({ effect, tagsById }) => (
      <>
        <Line label="Handed over">
          <TagStack effect={effect} tagsById={tagsById} /> to {effect.toName ?? "?"}
        </Line>
        <p className="text-xs text-muted">
          Undo moves the tag back to its original holder.
        </p>
      </>
    ),
  },

  DONATE_BLOOD: {
    heading: "Donate Blood",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Bled">
          {effect.targetName ?? "—"}
          {effect.tier ? (
            <span className="text-muted"> · {effect.tier} blood, worth {effect.nominalAmount}</span>
          ) : null}
        </Line>
        <Line label="Pool">
          {effect.bloodBefore ?? 0} → {effect.bloodAfter ?? 0}
        </Line>
        <BloodField value={edits.bloodDelta} onChange={(v) => setEdit("bloodDelta", v)} />
        <CheckField
          checked={Boolean(edits.removeDrained)}
          onChange={(e) => setEdit("removeDrained", e.target.checked)}
        >
          Clear their Drained tag but keep the blood
        </CheckField>
      </>
    ),
  },

  FEED_PERSON: {
    heading: "Feed Person",
    render: ({ effect, edits, setEdit, onKill, killing }) => (
      <>
        <Line label="Fed">{effect.targetName ?? "—"}</Line>
        <Line label="Pool">
          {effect.bloodBefore ?? 0} → {effect.bloodAfter ?? 0}
        </Line>
        <BloodField value={edits.bloodDelta} onChange={(v) => setEdit("bloodDelta", v)} />

        {effect.killed ? (
          <p className="text-sm text-muted">
            ☠ {effect.targetName ?? "They"} has been killed.
          </p>
        ) : (
          <div
            className="flex flex-col gap-2 border-t pt-3"
            style={{ borderColor: "var(--accent)" }}
          >
            <p className="text-sm text-accent">
              ☠ {effect.targetName ?? "This character"} is still alive. Feeding someone to the Lifeweb marks them as dying, but a GM has to kill them themselves.
            </p>
            <button
              type="button"
              className="btn self-start"
              style={{ borderColor: "var(--accent)", color: "var(--accent-text)" }}
              onClick={onKill}
              disabled={killing}
            >
              {killing ? "Working…" : `Kill ${effect.targetName ?? "them"}`}
            </button>
            <p className="text-xs text-muted">
              This deletes their personal Discord role, clears their nickname and marks them Cursed.
            </p>
          </div>
        )}
      </>
    ),
  },

  // The one type whose subject isn't the character who filed it, so the
  // patient is named explicitly rather than left to the desk's universal
  // half (which shows the requester).
  HEAL_CHARACTER: {
    heading: "Heal",
    render: ({ effect, edits, setEdit, tagsById }) => (
      <>
        <Line label="Patient">
          {effect.targetCharacterId ? (
            <CharacterLink characterId={effect.targetCharacterId} name={effect.targetName ?? "—"} isGm />
          ) : (
            (effect.targetName ?? "—")
          )}
          {effect.selfHeal ? <span className="text-muted"> — themselves</span> : null}
        </Line>
        <Line label="Cured">
          <TagStack effect={effect} tagsById={tagsById} />
        </Line>
        {effect.requirement?.skills?.length ? (
          <Line label="Needed">{effect.requirement.skills.join(", ")}</Line>
        ) : null}
        <Line label="Paid by">
          {effect.payer?.name ?? "—"} — <span className="mono">{effect.resourcesSpent ?? 0} ⬢</span>
        </Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <CheckField
          checked={Boolean(edits.restoreHealedTag)}
          onChange={(e) => setEdit("restoreHealedTag", e.target.checked)}
        >
          Put the affliction back but keep the payment
        </CheckField>
      </>
    ),
  },

  CHANGE_NAME: {
    heading: "Change Name",
    render: ({ effect }) => (
      <>
        <Line label="Now">{effect.next?.name ?? "—"}</Line>
        <Line label="Was">{effect.previous?.name ?? <span className="text-muted">nothing</span>}</Line>
        {/* Only older Request rows, from before renaming stopped costing a
            Mulligan Potion, carry this key — see requestEffects.js. */}
        {effect.potionTagId && <Line label="Spent">1 Mulligan Potion</Line>}
      </>
    ),
  },

  // System-filed by db/lib/cavingPass.js on a Caving Die roll of 6 — see
  // docs/systemdocs/CAVING.md. `payload.tier` names which of the six loot
  // tiers this drew from.
  CAVING_LOOT: {
    heading: "Caving Find",
    render: ({ effect, payload, tagsById }) => (
      <>
        <Line label="Found">
          <TagStack effect={effect} tagsById={tagsById} />
        </Line>
        <Line label="Tier">{payload?.tier ?? "—"}</Line>
      </>
    ),
  },

  // Subject differs from filer, same as HEAL_CHARACTER: the patient/victim
  // is named explicitly rather than left to the desk's universal half.
  LOOT_CHARACTER: {
    heading: "Loot Character",
    render: ({ effect }) => (
      <>
        <Line label="Taken from">
          {effect.targetCharacterId ? (
            <CharacterLink characterId={effect.targetCharacterId} name={effect.targetName ?? "—"} isGm />
          ) : (
            (effect.targetName ?? "—")
          )}
        </Line>
        <Line label="Tags">
          {(effect.tags ?? []).length
            ? effect.tags.map((t) => stackLabel(t)).join(", ")
            : "—"}
        </Line>
        <Line label="⬢ taken">{effect.amount ?? 0}</Line>
        <p className="text-xs text-muted">
          Undo returns every tag and the ⬢ to the target.
        </p>
      </>
    ),
  },

  MOVE_CHARACTER: {
    heading: "Move Character",
    render: ({ effect }) => (
      <>
        <Line label="Moved">
          {effect.targetCharacterId ? (
            <CharacterLink characterId={effect.targetCharacterId} name={effect.targetName ?? "—"} isGm />
          ) : (
            (effect.targetName ?? "—")
          )}
        </Line>
        <Line label="To">{effect.toZoneName ?? "—"}</Line>
        <p className="text-xs text-muted">
          Undo restores their previous zone in the database. It does not re-sync Discord access —
          that catches up the next time they make an ordinary Move.
        </p>
      </>
    ),
  },

  CREATE_TAG: {
    heading: "Create Item",
    render: ({ effect }) => (
      <>
        <Line label="Item">{stackLabel(effect)}</Line>
        <Line label="Spent">{effect.resourcesSpent ?? 0} ⬢</Line>
        <p className="text-xs text-muted">
          Undo takes the grant back, refunds the cost, and deletes the tag itself if nobody else holds it.
        </p>
      </>
    ),
  },
};
