import { updateCharacterProfile, setMood, transferResources } from "../(app)/character/actions";
import AppearanceField from "./AppearanceField";

function groupTagsByCategory(characterTags) {
  const groups = new Map();
  for (const ct of characterTags) {
    const category = ct.tag.category?.trim() || "Other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(ct.tag);
  }
  return [...groups.entries()];
}

function ActionStatus({ currentAction, openTurn }) {
  if (!openTurn) return <p className="text-sm" style={{ color: "var(--muted)" }}>No turn is currently open.</p>;

  if (!currentAction) return null;

  return (
    <div className="text-sm">
      <p className="mb-1">
        {currentAction.type === "MOVE" ? "Move" : "Effort"}: {currentAction.description}
      </p>
      {currentAction.status === "PENDING" && (
        <p style={{ color: "var(--muted)" }}>Pending confirmation — check Discord DMs and react ✅ to lock it in.</p>
      )}
      {currentAction.status === "CONFIRMED" && (
        <p style={{ color: "var(--muted)" }}>
          Confirmed{currentAction.diceRoll != null ? ` — rolled ${currentAction.diceRoll}` : ""} — awaiting GM adjudication.
        </p>
      )}
      {currentAction.status === "ADJUDICATED" && (
        <p style={{ color: "var(--muted)" }}>Adjudicated: {currentAction.gmNotes || "(no notes)"}</p>
      )}
    </div>
  );
}

function moodColor(moodState) {
  if (moodState === "HAPPY") return "var(--mood-happy)";
  if (moodState === "UNHAPPY") return "var(--accent)";
  return "var(--text)";
}

export default function CharacterSheet({
  character,
  mode,
  currentAction,
  openTurn,
  avatarSrc,
  transferTargets,
}) {
  const isSelf = mode === "self";
  const tagGroups = groupTagsByCategory(character.tags);
  const turnsLeft =
    character.moodState !== "NEUTRAL" && openTurn && character.moodExpiresTurn != null
      ? character.moodExpiresTurn - openTurn.number
      : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center gap-4">
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt={character.name}
            className="h-16 w-16 object-cover"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-16 w-16"
            style={{ background: "#9a9a9a", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
          />
        )}
        <div>
          <h1 className="text-2xl font-bold">{character.name}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {character.roleTitle ?? "No role"} — {character.faction?.name ?? "No faction"}
          </p>
        </div>
      </div>

      {isSelf && (
        <section className="panel p-4">
          <h2 className="mb-3 font-bold">Bio</h2>
          <form action={updateCharacterProfile} encType="multipart/form-data" className="flex flex-col gap-3">
            <label className="field">
              <span className="field-label">Name</span>
              <input name="name" defaultValue={character.name} required />
            </label>
            <label className="field">
              <span className="field-label">Profile picture</span>
              <input type="file" name="avatar" accept="image/*" />
            </label>
            <AppearanceField defaultValue={character.appearance ?? ""} />
            <button type="submit" className="btn self-start">
              Save
            </button>
          </form>
        </section>
      )}

      {!isSelf && character.appearance && (
        <section className="panel p-4">
          <h2 className="mb-2 font-bold">Appearance</h2>
          <p className="text-sm">{character.appearance}</p>
        </section>
      )}

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Status</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>Zone: {character.zone?.name ?? "Unassigned"}</li>
          <li>Resources ⬢: {character.resources}</li>
          <li style={{ color: moodColor(character.moodState) }}>
            Mood: {character.moodState}
            {character.moodNote ? ` — "${character.moodNote}"` : ""}
            {turnsLeft != null ? ` (${turnsLeft} turn${turnsLeft === 1 ? "" : "s"} left)` : ""}
          </li>
          <li style={{ color: character.isHungry ? "var(--accent)" : "var(--text)" }}>
            Hungry: {character.isHungry ? "Yes" : "No"}
          </li>
          <li>Tag Points: {character.tagPoints}</li>
        </ul>

        {isSelf && (
          <form action={setMood} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="field">
              <span className="field-label">
                Set mood
                {turnsLeft != null ? (
                  <span style={{ color: moodColor(character.moodState) }}>
                    {" "}
                    ({turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left)
                  </span>
                ) : null}
              </span>
              <select name="moodState" defaultValue={character.moodState}>
                <option value="NEUTRAL">Neutral</option>
                <option value="HAPPY">Happy</option>
                <option value="UNHAPPY">Unhappy</option>
              </select>
            </label>
            <label className="field flex-1">
              <span className="field-label">Why (optional, for the GM)</span>
              <input name="moodNote" defaultValue={character.moodNote ?? ""} placeholder="A lavish meal, a duel lost..." />
            </label>
            <button type="submit" className="btn">
              Update
            </button>
          </form>
        )}

        {isSelf && (
          <form action={transferResources} className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <label className="field">
              <span className="field-label">Send resources ⬢ to</span>
              <select name="target" required defaultValue="">
                <option value="" disabled>
                  Choose a recipient...
                </option>
                {transferTargets?.characters?.length ? (
                  <optgroup label="Players">
                    {transferTargets.characters.map((c) => (
                      <option key={c.id} value={`character:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {transferTargets?.factions?.length ? (
                  <optgroup label="Factions (adds to Silo)">
                    {transferTargets.factions.map((f) => (
                      <option key={f.id} value={`faction:${f.id}`}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <label className="field" style={{ width: "6rem" }}>
              <span className="field-label">Amount</span>
              <input name="amount" type="number" min="1" max={character.resources} required />
            </label>
            <button type="submit" className="btn" disabled={character.resources <= 0}>
              Transfer
            </button>
          </form>
        )}
      </section>

      {!isSelf && currentAction && (
        <section className="panel p-4">
          <h2 className="mb-2 font-bold">This turn</h2>
          <ActionStatus currentAction={currentAction} openTurn={openTurn} />
        </section>
      )}

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Tags</h2>
        {tagGroups.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No tags yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {tagGroups.map(([category, tags]) => (
              <div key={category}>
                <p className="field-label mb-1">{category}</p>
                <ul className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <li key={tag.id} className="chip">
                      {tag.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {isSelf && (
          <button type="button" disabled={character.tagPoints <= 0} className="btn-quiet mt-3">
            Point Buy
          </button>
        )}
      </section>

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Desire</h2>
        {character.desires[0] ? (
          <p className="text-sm">{character.desires[0].description}</p>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No active desire set.</p>
        )}
      </section>
    </div>
  );
}
