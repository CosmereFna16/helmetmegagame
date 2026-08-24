import { AGE_MIN, AGE_MAX } from "@/lib/characterName";
import InfoIcon from "./InfoIcon";

// The name half of the Bio form on /character. Every field here is now
// READ-ONLY: a character's name is set in the creation wizard and never
// changes again, so there is nothing to control and nothing to randomize —
// which is why this went back to a plain server component with `defaultValue`
// inputs, the same shape as the `age` and `title` fields it sits beside.
//
// Being `disabled` these submit nothing, and `updateCharacterProfile` ignores
// the name keys outright regardless of what is posted — that server action,
// not the greying, is the lock. The creation wizard is unaffected:
// CreateCharacterWizard.js carries its own name fields and its own Randomize.
//
// The one way a name ever changes now is the Mulligan Potion in
// docs/tags.yaml, honoured by a GM from /gm/dev/characters/[characterId].
const NAME_LOCK_HINT =
  "Your name is fixed once your character is made. A Mulligan Potion buys you one change — drink it, then ask the GMs.";

export default function BioNameFields({ character }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="field">
        <span className="field-label flex items-center gap-1.5">
          Title
          <InfoIcon text={NAME_LOCK_HINT} />
        </span>
        <input defaultValue={character.honorific ?? ""} placeholder="(none)" disabled />
      </label>
      <label className="field">
        <span className="field-label flex items-center gap-1.5">
          First name
          <InfoIcon text={NAME_LOCK_HINT} />
        </span>
        <input defaultValue={character.firstName ?? ""} disabled />
      </label>
      <label className="field">
        <span className="field-label flex items-center gap-1.5">
          Last name
          <InfoIcon text={NAME_LOCK_HINT} />
        </span>
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
  );
}
