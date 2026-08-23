"use client";

import { useState } from "react";
import { HONORIFICS, NAME_LIMITS, AGE_MIN, AGE_MAX } from "@/lib/characterName";
import { randomCharacterName } from "@/lib/nameCorpus";
import InfoIcon from "./InfoIcon";

// The name half of the Bio form on /character, split out of CharacterSheet.js
// only because Randomize needs somewhere to write: the fields were uncontrolled
// `defaultValue` inputs, and a button cannot set those. Everything else about
// them is unchanged — same grid, same `name` attributes, same disabled rules —
// so `updateCharacterProfile` reads exactly the fields it always did.
//
// The whole grid moved rather than just the three fields Randomize touches,
// because splitting it would have left `sm:grid-cols-2` spanning two components.
export default function BioNameFields({ character, lastNameLocked = false }) {
  const [honorific, setHonorific] = useState(character.honorific ?? "");
  const [firstName, setFirstName] = useState(character.firstName ?? "");
  const [lastName, setLastName] = useState(character.lastName ?? "");

  // Same rule as the creation wizard: the honorific in the dropdown picks the
  // pool, and a dynasty surname is left alone rather than rolled and discarded.
  function rollName() {
    const rolled = randomCharacterName({ honorific, lastNameLocked });
    setFirstName(rolled.firstName);
    if (!lastNameLocked) setLastName(rolled.lastName ?? "");
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">Title</span>
          <select
            name="honorific"
            value={honorific}
            onChange={(e) => setHonorific(e.target.value)}
          >
            <option value="">(none)</option>
            {HONORIFICS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">First name</span>
          <input
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={NAME_LIMITS.firstName}
            required
          />
        </label>
        {/* The Baron's family wear his surname rather than choosing
            one, so the field is shown but dead — updateCharacterProfile
            never reads it for them, which is the actual lock. */}
        <label className="field">
          <span className="field-label flex items-center gap-1.5">
            {lastNameLocked ? "Last name" : "Last name (optional)"}
            {lastNameLocked && (
              <InfoIcon text="Your dynasty's name, chosen by the Baron. It updates on its own when he takes or changes it." />
            )}
          </span>
          <input
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={NAME_LIMITS.lastName}
            placeholder={lastNameLocked ? "No dynasty name yet" : undefined}
            disabled={lastNameLocked}
          />
        </label>
        {/* Free to set once, then fixed — same treatment as the
            GM-granted title below. The disabled input submits nothing,
            and updateCharacterProfile refuses to overwrite a non-null
            age regardless, which is the actual lock. */}
        <label className="field">
          <span className="field-label flex items-center gap-1.5">
            Age
            {character.age !== null && (
              <InfoIcon text="Your age is fixed once you set it. Ask a GM if it needs changing." />
            )}
          </span>
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
            Granted title
            <InfoIcon text="Granted by a GM, and rendered in quotes between your names. Make your case to a GM." />
          </span>
          <input defaultValue={character.title ?? ""} placeholder="None granted" disabled />
        </label>
      </div>
      {/* Nothing is saved until the form is submitted, so a roll is free to
          undo — hence a button rather than a confirm. */}
      <div className="flex justify-end">
        <button type="button" className="btn-secondary" onClick={rollName}>
          Randomize name
        </button>
      </div>
    </>
  );
}
