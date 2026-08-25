"use client";

import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import CheckField from "@/app/components/CheckField";
import { useState, useTransition } from "react";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import CharacterLink from "@/app/components/CharacterLink";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import Tooltip from "@/app/components/Tooltip";
import { resolveRequest, killRequestTarget } from "./actions";
import FactionLink from "@/app/components/FactionLink";

// The Request Adjudication Panel: a universal top half describing the
// request, then a type-specific bottom half. Adding a RequestType means
// adding one entry to SECTIONS below and one to REQUEST_EFFECTS in
// web/lib/requestEffects.js — nothing else here changes.

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
  return (effect.quantity ?? 1) > 1 ? `${name} \u00d7${effect.quantity}` : name;
}

const SECTIONS = {
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
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Tag added">{stackLabel(effect)}</Line>
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

  REMOVE_TAG: {
    heading: "Remove Tag",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Tag removed">{stackLabel(effect)}</Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <p className="text-xs text-muted">
          Undo puts the tag back with its original source and expiry, and refunds the cost.
        </p>
      </>
    ),
  },

  CONSUME_TAG: {
    heading: "Consume Tag",
    render: ({ effect }) => (
      <>
        <Line label="Consumed">{effect.tagName ?? "—"}</Line>
        <Line label="Became">
          {(effect.granted ?? []).filter((g) => g.added > 0).length
            ? effect.granted
                .filter((g) => g.added > 0)
                .map((g) => (g.added > 1 ? `${g.tagName} \u00d7${g.added}` : g.tagName))
                .join(", ")
            : "—"}
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
    render: ({ effect }) => (
      <>
        <Line label="Handed over">
          {stackLabel(effect)} to {effect.toName ?? "?"}
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
              ☠ {effect.targetName ?? "This character"} is still alive. Feeding someone to the Lifeweb markes them as dying, but a GM has to kill them themselves.
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

  CHANGE_WORST_FEAR: {
    heading: "Change Worst Fear",
    render: ({ effect }) => (
      <>
        <Line label="Now">{effect.text ?? "—"}</Line>
        <Line label="Was">
          {effect.previousText ?? <span className="text-muted">nothing</span>}
        </Line>
      </>
    ),
  },

  FULFILL_WORST_FEAR: {
    heading: "Worst Fear Comes True",
    render: ({ effect }) => (
      <>
        <Line label="Fear">{effect.fearText ?? "—"}</Line>
        <Line label="Cost">
          <span className="text-accent">&minus;{effect.pointsDeducted ?? 0} Tag Points</span>
        </Line>
        {effect.fulfilledTurnNumber != null && (
          <Line label="On turn">{effect.fulfilledTurnNumber}</Line>
        )}
        <p className="text-xs text-muted">
          Always exactly &minus;{effect.pointsDeducted ?? 0}.
        </p>
      </>
    ),
  },

  // The one type whose subject isn't the character who filed it, so the
  // patient is named explicitly rather than left to the panel's universal
  // half (which shows the requester).
  HEAL_CHARACTER: {
    heading: "Heal",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Patient">
          {effect.targetCharacterId ? (
            <CharacterLink characterId={effect.targetCharacterId} name={effect.targetName ?? "—"} isGm />
          ) : (
            (effect.targetName ?? "—")
          )}
          {effect.selfHeal ? <span className="text-muted"> — themselves</span> : null}
        </Line>
        <Line label="Cured">{effect.tagName ?? "—"}</Line>
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

  SET_MOOD: {
    heading: "Set Mood",
    render: ({ effect }) => (
      <>
        <Line label="Mood set to">{effect.mood ?? "NEUTRAL"}</Line>
        {effect.expiresTurn != null && <Line label="Expires">turn {effect.expiresTurn}</Line>}
        <p className="text-xs text-muted">
          Undo restores whatever mood this replaced.
        </p>
      </>
    ),
  },

  CHANGE_NAME: {
    heading: "Change Name",
    render: ({ effect }) => (
      <>
        <Line label="Now">{effect.next?.name ?? "—"}</Line>
        <Line label="Was">{effect.previous?.name ?? <span className="text-muted">nothing</span>}</Line>
        <Line label="Spent">1 Mulligan Potion</Line>
      </>
    ),
  },
};

export default function RequestPanel({ request, readOnly = false, onClose }) {
  const effect = request?.effect ?? {};
  const [edits, setEdits] = useState({
    resourcesSpent: String(effect.resourcesSpent ?? 0),
    pointsAwarded: String(effect.pointsAwarded ?? 0),
    bloodDelta: String(effect.bloodDelta ?? 0),
    removeTag: false,
    removeDrained: false,
    restoreHealedTag: false,
  });
  const [gmNotes, setGmNotes] = useState(request?.gmNotes ?? "");
  const [error, setError] = useState(null);
  const [killing, setKilling] = useState(false);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard({ enabled: !readOnly });
  const confirm = useConfirm();

  if (!request) return null;
  const section = SECTIONS[request.type];

  function setEdit(key, value) {
    markDirty();
    setEdits((e) => ({ ...e, [key]: value }));
  }

  function run(mode) {
    setError(null);
    startTransition(async () => {
      const res = await resolveRequest({ requestId: request.id, mode, edits, gmNotes });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      onClose();
    });
  }

  // Killing is irreversible and lands on someone else's character, so it sits
  // behind the shared confirm dialog on top of this panel.
  async function onKill() {
    setError(null);
    const ok = await confirm({
      title: `Kill ${effect.targetName ?? "this character"}?`,
      message:
        "This ends their game: the personal Discord role is deleted, the nickname cleared, and Cursed granted. It cannot be undone from here.",
      confirmLabel: "Kill them",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    setKilling(true);
    try {
      const res = await killRequestTarget({ requestId: request.id });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      onClose();
    } finally {
      setKilling(false);
    }
  }

  const close = () => (readOnly ? onClose() : guardedClose(onClose));

  return (
    <Modal
      title={readOnly ? "Request (read only)" : "Request"}
      width="wide"
      onClose={() => !pending && close()}
      actions={<DevCharacterButton characterId={request.characterId} name={request.characterName} />}
    >
      <div className="mt-3 flex flex-col gap-2">
        <Line label="Character">
          <CharacterLink characterId={request.characterId} name={request.characterName} isGm />{" "}
          <span className="text-muted">({request.discordUsername})</span>
        </Line>
        <Line label="Faction">
          <FactionLink factionId={request.factionId} name={request.factionName || "—"} />
        </Line>
        <Line label="Turn">{request.turnLabel}</Line>
        <Line label="Type">{request.typeLabel}</Line>
        <Line label="Status">{request.statusLabel}</Line>
        <Line label="Reason">{request.reason}</Line>
        <p className="text-xs text-muted">
          To reduce GM load, players can make big changes.
        </p>
      </div>

      {section && (
        <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="field-label">{section.heading}</h3>
          <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
            <div className="flex flex-col gap-3">
              {section.render({ effect, edits, setEdit, onKill, killing })}
            </div>
          </fieldset>
        </div>
      )}

      <label className="field mt-4">
        <span className="field-label">GM notes</span>
        <textarea
          rows={2}
          value={gmNotes}
          disabled={readOnly}
          onChange={(e) => {
            markDirty();
            setGmNotes(e.target.value);
          }}
        />
      </label>

      <FormError>{error}</FormError>

      {/* "Reviewed by", not "Solved by": Review is the Request verb
          everywhere else in this UI, and Solved is Move vocabulary bound to a
          MoveReviewStatus value. Same shape as MovePanel's stamp, right
          noun. */}
      {request.reviewedByUsername && (
        <p className="mt-3 text-xs text-muted">
          Reviewed by {request.reviewedByUsername}
          {request.reviewedAtLabel ? ` · ${request.reviewedAtLabel}` : ""}
        </p>
      )}

      <div className="modal-actions flex-wrap">
        <Tooltip text="Leave the request as the player made it and discard your edits">
          <button type="button" className="btn-quiet" onClick={close} disabled={pending}>
            {readOnly ? "Close" : "Cancel"}
          </button>
        </Tooltip>
        {!readOnly && (
          <>
            <Tooltip text="Reverse the change entirely and mark the request Undone">
              <button
                type="button"
                className="btn-quiet"
                onClick={() => run("undo")}
                disabled={pending}
              >
                Undo
              </button>
            </Tooltip>
            <Tooltip text="Apply your edits and mark the request Edited">
              <button type="button" className="btn" onClick={() => run("confirm")} disabled={pending}>
                {pending ? "Working…" : "Confirm"}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </Modal>
  );
}
