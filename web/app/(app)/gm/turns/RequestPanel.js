"use client";

import { useState, useTransition } from "react";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { resolveRequest } from "./actions";

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
      <span className="field-label">Resources spent ⬢</span>
      <input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const SECTIONS = {
  FULFILL_DESIRE: {
    heading: "Fulfill Desire",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Desire">{effect.desireText ?? "—"}</Line>
        <Line label="Awarded">{effect.pointsAwarded ?? 0} Tag Points</Line>
        <label className="field" style={{ width: "12rem" }}>
          <span className="field-label">Tag Points awarded</span>
          <input
            type="number"
            min="0"
            value={edits.pointsAwarded}
            onChange={(e) => setEdit("pointsAwarded", e.target.value)}
          />
        </label>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Confirm moves only the difference, so re-scoring twice never double-pays. Undo revokes the
          award even if the balance goes negative, and reopens the Desire.
        </p>
      </>
    ),
  },

  ADD_TAG: {
    heading: "Add Tag",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Tag added">{effect.tagName ?? "—"}</Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(edits.removeTag)}
            onChange={(e) => setEdit("removeTag", e.target.checked)}
          />
          Remove the tag but keep the resource cost
        </label>
      </>
    ),
  },

  REMOVE_TAG: {
    heading: "Remove Tag",
    render: ({ effect, edits, setEdit }) => (
      <>
        <Line label="Tag removed">{effect.tagName ?? "—"}</Line>
        <SpendField value={edits.resourcesSpent} onChange={(v) => setEdit("resourcesSpent", v)} />
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Undo puts the tag back with its original source and expiry, and refunds the cost.
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
        <p className="text-xs" style={{ color: "var(--muted)" }}>
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
          {effect.tagName ?? "—"} to {effect.toName ?? "?"}
        </Line>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Undo moves the tag back to its original holder.
        </p>
      </>
    ),
  },

  SET_MOOD: {
    heading: "Set Mood",
    render: ({ effect }) => (
      <>
        <Line label="Mood set to">{effect.mood ?? "NEUTRAL"}</Line>
        {effect.expiresTurn != null && <Line label="Expires">turn {effect.expiresTurn}</Line>}
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Undo restores whatever mood this replaced.
        </p>
      </>
    ),
  },
};

export default function RequestPanel({ request, onClose }) {
  const effect = request?.effect ?? {};
  const [edits, setEdits] = useState({
    resourcesSpent: String(effect.resourcesSpent ?? 0),
    pointsAwarded: String(effect.pointsAwarded ?? 0),
    removeTag: false,
  });
  const [gmNotes, setGmNotes] = useState(request?.gmNotes ?? "");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

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

  const close = () => guardedClose(onClose);

  return (
    <div className="modal-overlay" onClick={() => !pending && close()}>
      <div className="modal-panel" style={{ maxWidth: "36rem" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-bold">Request</h2>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <Line label="Character">
            {request.characterName}{" "}
            <span style={{ color: "var(--muted)" }}>({request.discordUsername})</span>
          </Line>
          <Line label="Faction">{request.factionName || "—"}</Line>
          <Line label="Turn">{request.turnLabel}</Line>
          <Line label="Type">{request.typeLabel}</Line>
          <Line label="Status">{request.statusLabel}</Line>
          <Line label="Reason">{request.reason}</Line>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            To reduce GM load, players can make big changes.
          </p>
        </div>

        {section && (
          <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="field-label">{section.heading}</h3>
            {section.render({ effect, edits, setEdit })}
          </div>
        )}

        <label className="field mt-4">
          <span className="field-label">GM notes</span>
          <textarea
            rows={2}
            value={gmNotes}
            onChange={(e) => {
              markDirty();
              setGmNotes(e.target.value);
            }}
          />
        </label>

        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--accent)" }}>
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="btn-quiet"
            title="Leave the request as the player made it and discard your edits"
            onClick={close}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-quiet"
            title="Reverse the change entirely and mark the request Undone"
            onClick={() => run("undo")}
            disabled={pending}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn"
            title="Apply your edits and mark the request Edited"
            onClick={() => run("confirm")}
            disabled={pending}
          >
            {pending ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
