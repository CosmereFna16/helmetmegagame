"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
import Select from "./Select";
import FormError from "./FormError";
import { peopleToExamine, examineCharacter } from "@/app/(app)/character/examineActions";

// Look at — the Examine control on the Actions grid.
//
// One of two entries on that grid which file no Request (ReadDialog.js is the
// other), so it gets its own plain modal rather than being forced through the
// Requests popup: there is no reason to type, nothing for a GM to review and
// nothing to undo. See examineActions.js for why the feature exists at all.
//
// Two round trips on purpose. The roster loads when the dialog opens, so it is
// current rather than baked into the page render; the readout loads when a
// name is picked, so opening the dialog never fetches everybody's sheet.
export default function ExamineDialog({ open, onClose }) {
  if (!open) return null;
  return <ExamineDialogBody onClose={onClose} />;
}

function ExamineDialogBody({ onClose }) {
  const [roster, setRoster] = useState({ loading: true, people: [], error: null });
  const [chosen, setChosen] = useState("");
  const [look, setLook] = useState({ loading: false, readout: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await peopleToExamine();
      if (cancelled) return;
      if (res?.ok) setRoster({ loading: false, people: res.people, error: null });
      else setRoster({ loading: false, people: [], error: res?.error ?? "Couldn't see who's here. ‡" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(id) {
    setChosen(id);
    if (!id) {
      setLook({ loading: false, readout: null, error: null });
      return;
    }
    setLook({ loading: true, readout: null, error: null });
    const res = await examineCharacter(id);
    if (res?.ok) setLook({ loading: false, readout: res.readout, error: null });
    else setLook({ loading: false, readout: null, error: res?.error ?? "You can't see them. ‡" });
  }

  return (
    <Modal title="Look at" onClose={onClose}>
      <div className="mt-3 flex flex-col gap-3">
        {roster.loading && <p className="text-sm text-muted">Looking around… ‡</p>}
        {roster.error && <FormError>{roster.error}</FormError>}

        {!roster.loading && !roster.error && roster.people.length === 0 && (
          <p className="text-sm text-muted">There is nobody else here. ‡</p>
        )}

        {roster.people.length > 0 && (
          <label className="field">
            <span className="field-label">Who</span>
            <Select value={chosen} onChange={(e) => pick(e.target.value)}>
              <option value="">Pick somebody…</option>
              {roster.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
        )}

        {look.loading && <p className="text-sm text-muted">Looking… ‡</p>}
        {look.error && <FormError>{look.error}</FormError>}
        {look.readout && <Readout readout={look.readout} />}
      </div>
    </Modal>
  );
}

function Readout({ readout }) {
  return (
    <div className="panel flex flex-col gap-3" style={{ padding: "0.75rem" }}>
      <div className="flex items-center gap-2">
        {/* A plain <img>, not CharacterAvatar: that component builds its own
            /api/avatar/<id> URL, which would serve the real face for somebody
            standing here under a hood. presentedIdentity already decided which
            face this is — the silhouette, a letter plaque or their own — and
            the whole point is to render THAT and nothing else. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={readout.avatarPath}
          alt=""
          width={32}
          height={32}
          style={{ borderRadius: "var(--r-full)", objectFit: "cover", flexShrink: 0 }}
        />
        <strong>{readout.name}</strong>
      </div>

      {readout.line && <p className="text-sm text-muted">{readout.line}</p>}
      {readout.appearance && <p className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{readout.appearance}</p>}
      {!readout.concealed && !readout.appearance && (
        <p className="text-sm text-muted">Nothing about them stands out. ‡</p>
      )}

      <Line label="Ailments" values={readout.ailments} />
      <Line label="Equipment" values={readout.equipment} />

      {readout.tags.length > 0 && (
        <div className="field">
          <span className="field-label">What you can see</span>
          <p className="text-sm">
            {readout.tags.map((t, i) => (
              <span key={t.name}>
                {i > 0 && ", "}
                {t.name}
                {t.detail && <span className="text-muted"> ({t.detail})</span>}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Role is same-faction knowledge; ⬢ is a Leader/Treasurer of their own
          faction reading their own roster. Both decided in db/lib/examine.js,
          so this surface and 🔍 answer alike. */}
      <Line label="Role" values={readout.roleTitle ? [readout.roleTitle] : null} />
      <Line label="Resources" values={readout.resources != null ? [`${readout.resources} ⬢`] : null} />

      {/* Rendered only when the looker holds the sight that buys it. An empty
          read prints the same words a guarded one does, so Inscrutable never
          advertises itself — db/lib/inspectVision.js. */}
      {readout.desire && (
        <div className="field">
          <span className="field-label">Last Desire</span>
          <p className="text-sm">
            {readout.desire.text ? `» ${readout.desire.text} (+${readout.desire.points})` : "Nothing you can read. ‡"}
          </p>
        </div>
      )}
    </div>
  );
}

function Line({ label, values }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <p className="text-sm">{values.join(", ")}</p>
    </div>
  );
}
