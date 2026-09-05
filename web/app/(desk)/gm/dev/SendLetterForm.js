"use client";

// The Dev Panel's Send Letter form. See docs/systemdocs/BIRD.md §9.
//
// A client component for two reasons, both of which a bare
// <form action={...}> in the server page could not do: the seal fields have to
// appear only once Sealed is on, and the action's refusals ("no turn is open",
// "they're past reading it") have to land somewhere the GM can read them. Same
// call BioForm.js makes, for the same reason.

import { useActionState, useState } from "react";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import Switch from "@/app/components/Switch";
import { sendGmLetter } from "../../../(app)/gm/dev/actions";

export default function SendLetterForm({ characters }) {
  const [state, formAction, pending] = useActionState(sendGmLetter, null);
  const [sealed, setSealed] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">From</span>
          <input
            name="senderName"
            type="text"
            maxLength={80}
            placeholder="God-King Enoch II ‡"
            className="min-w-64"
          />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <Select name="recipientId" className="min-w-64">
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.location ? ` — ${c.location.name}` : ""}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">The letter</span>
        <textarea name="body" rows={8} maxLength={2000} className="w-full" />
      </label>

      <div className="ops-toggle">
        <Switch name="sealed" checked={sealed} onChange={(e) => setSealed(e.target.checked)}>
          Sealed
        </Switch>
      </div>

      {sealed && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="field-label">Seal name</span>
            <input name="sealLabel" type="text" maxLength={40} placeholder="Royal" className="min-w-48" />
            <span className="text-xs text-muted">The letter arrives titled &ldquo;Sealed Letter (Royal)&rdquo;. ‡</span>
          </label>
          <label className="field min-w-72 flex-1">
            <span className="field-label">What the wax carries</span>
            <input
              name="sealMark"
              type="text"
              maxLength={200}
              placeholder="A crown over crossed howitzers. ‡"
              className="w-full"
            />
            <span className="text-xs text-muted">Anyone holding it reads this, literate or not. ‡</span>
          </label>
        </div>
      )}

      <FormError>{state?.error}</FormError>
      {state?.ok && <p className="text-sm text-positive">{state.message}</p>}

      <button type="submit" className="btn self-start" disabled={pending}>
        {pending ? "Sending…" : "Send it"}
      </button>
    </form>
  );
}
