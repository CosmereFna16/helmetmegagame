"use client";

import { useMemo, useState, useTransition } from "react";
import { earnedTitles, NAME_LIMITS, AGE_MIN, AGE_MAX } from "@/lib/characterName";
import { randomCharacterName } from "@/lib/nameCorpus";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import { changeNameRequest } from "../(app)/character/requestActions";

// The name half of the Bio form on /character. The four fields here are
// READ-ONLY server-rendered inputs — a name is set in the creation wizard
// and `updateCharacterProfile` ignores the name keys outright regardless of
// what this form posts, which (not the greying) is the actual lock. See
// docs/systemdocs/CHARACTERS.md §1b.
//
// The one way a name changes after that is drinking a Mulligan Potion
// (docs/tags.yaml), which is now a Request like any other — it applies
// immediately and a GM can Undo it from /gm/turns. That is the "Change
// name" control below, wired through web/lib/requestEffects.js's
// CHANGE_NAME entry rather than this form's own submit.
//
// Why these fields carry no InfoIcon of their own: CharacterSheet.js already
// puts one summary tooltip on the "Bio" heading covering name-and-age being
// locked, so repeating it per field was one tooltip too many. `title` below
// (the GM-granted one, in quotes) keeps its own because it explains a
// DIFFERENT thing — how to get one, not why it's locked.
const MULLIGAN_POTION_SLUG = "mulligan-potion";

export default function BioNameFields({ character, lastNameLocked = false }) {
  const [open, setOpen] = useState(false);
  const [honorific, setHonorific] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const heldPotion = character.tags?.find((ct) => ct.tag?.slug === MULLIGAN_POTION_SLUG) ?? null;
  const potionCount = heldPotion?.quantity ?? 0;

  // The titles this character has earned, from what they hold and the role
  // they took. changeNameRequest re-checks exactly this server-side, so the
  // list and the gate cannot disagree.
  //
  // A title they wear but no longer qualify for is deliberately NOT re-added:
  // losing the tag leaves the word on the sheet, but claiming it again is not
  // on offer, so drinking a potion is a one-way door out of a title you can
  // no longer justify. A GM can put it back from the dev panel.
  const earned = useMemo(
    () =>
      earnedTitles({
        tagSlugs: (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
        roleSlug: character.role?.slug ?? null,
      }),
    [character.tags, character.role],
  );

  function openDialog() {
    // Seeded blank when the worn title is no longer earned — it isn't in the
    // list, so leaving it selected would show an empty control with a value
    // behind it that the server would reject anyway.
    setHonorific(earned.includes(character.honorific) ? character.honorific : "");
    setFirstName(character.firstName ?? "");
    setLastName(character.lastName ?? "");
    setError(null);
    setOpen(true);
  }

  // Same rule as the creation wizard and the old (pre-lock) Randomize: the
  // honorific in the dropdown picks the pool, and a dynasty surname is left
  // alone rather than rolled and discarded.
  function rollName() {
    const rolled = randomCharacterName({ honorific, lastNameLocked });
    setFirstName(rolled.firstName);
    if (!lastNameLocked) setLastName(rolled.lastName ?? "");
  }

  function submit(reason) {
    setError(null);
    startTransition(async () => {
      const res = await changeNameRequest({ honorific, firstName, lastName, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setOpen(false);
    });
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">Prefix</span>
          <input defaultValue={character.honorific ?? ""} placeholder="(none)" disabled />
        </label>
        <label className="field">
          <span className="field-label">First name</span>
          <input defaultValue={character.firstName ?? ""} disabled />
        </label>
        <label className="field">
          <span className="field-label">Last name</span>
          <input
            defaultValue={character.lastName ?? ""}
            placeholder="No last name"
            disabled
          />
        </label>
        {/* Free to set once, then fixed — same treatment as the
            GM-granted title below. The disabled input submits nothing,
            and updateCharacterProfile refuses to overwrite a non-null
            age regardless, which is the actual lock. */}
        <label className="field">
          <span className="field-label">Age</span>
          <input
            type="number"
            name="age"
            min={AGE_MIN}
            max={AGE_MAX}
            defaultValue={character.age ?? ""}
            placeholder={`${AGE_MIN}–${AGE_MAX}`}
            disabled={character.age !== null}
          />
        </label>
        {/* Granted by a GM, so it is shown but not editable. Being
            `disabled` it submits nothing, and updateCharacterProfile
            never reads it — that, not the greying, is the lock. */}
        <label className="field">
          <span className="field-label flex items-center gap-1.5">
            Title
            <InfoIcon text="Granted by a GM, and rendered in quotes between your names. Make your case to a GM." />
          </span>
          <input defaultValue={character.title ?? ""} placeholder="None granted" disabled />
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" className="btn-quiet" onClick={openDialog} disabled={!potionCount}>
          Change name
        </button>
        <InfoIcon
          text={
            potionCount
              ? `Drink a Mulligan Potion to take a new name. You have ${potionCount}. This takes effect immediately and a GM can undo it.`
              : "Drink a Mulligan Potion to unlock this — none of the buttons above take a new name."
          }
        />
      </div>

      <RequestDialog
        open={open}
        title="Change Name"
        submitLabel="Drink the potion"
        busy={pending}
        error={error}
        canSubmit={Boolean(firstName.trim())}
        onCancel={() => !pending && setOpen(false)}
        onConfirm={submit}
      >
        <label className="field">
          <span className="field-label flex items-center gap-1.5">
            Prefix
            <InfoIcon text="Titles are earned. Your role and the tags you hold decide which ones you may be styled by." />
          </span>
          <select
            value={honorific}
            onChange={(e) => setHonorific(e.target.value)}
            disabled={earned.length === 0}
          >
            <option value="">(none)</option>
            {earned.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">First name</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={NAME_LIMITS.firstName}
            required
          />
        </label>
        <label className="field">
          <span className="field-label flex items-center gap-1.5">
            {lastNameLocked ? "Last name" : "Last name (optional)"}
            {lastNameLocked && (
              <InfoIcon text="Your dynasty's name, chosen by the Baron. It updates on its own when he takes or changes it." />
            )}
          </span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={NAME_LIMITS.lastName}
            placeholder={lastNameLocked ? "No dynasty name yet" : undefined}
            disabled={lastNameLocked}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Uses 1 of your {potionCount} Mulligan Potion(s).</p>
          <button type="button" className="btn-secondary" onClick={rollName}>
            Randomize name
          </button>
        </div>
      </RequestDialog>
    </>
  );
}
