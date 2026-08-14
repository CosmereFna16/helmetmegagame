import { updateCharacterProfile, submitAction, setMood, transferResources } from "../(app)/character/actions";

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

export default function CharacterSheet({ character, mode, currentAction, openTurn, avatarSrc }) {
  const isSelf = mode === "self";
  const tagGroups = groupTagsByCategory(character.tags);

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
        ) : null}
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
            <label className="field">
              <span className="field-label">Appearance / description</span>
              <textarea
                name="appearance"
                defaultValue={character.appearance ?? ""}
                placeholder="What does your character look like?"
                rows={4}
              />
            </label>
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
          <li>Resources: {character.resources}</li>
          <li>
            Mood: {character.moodState}
            {character.moodNote ? ` — "${character.moodNote}"` : ""}
          </li>
          <li>Hungry: {character.isHungry ? "Yes" : "No"}</li>
          <li>Tag Points: {character.tagPoints}</li>
        </ul>

        {isSelf && (
          <form action={setMood} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="field">
              <span className="field-label">Set mood</span>
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
              <span className="field-label">Send resources to</span>
              <input name="targetName" placeholder="Character name" required />
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

      {isSelf && (
        <section className="panel p-4">
          <h2 className="mb-3 font-bold">Act</h2>
          {!openTurn ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>No turn is currently open.</p>
          ) : currentAction ? (
            <ActionStatus currentAction={currentAction} openTurn={openTurn} />
          ) : (
            <form action={submitAction} className="flex flex-col gap-3">
              <label className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <input type="radio" name="type" value="EFFORT" defaultChecked /> Effort
                </span>
                <span className="flex items-center gap-1">
                  <input type="radio" name="type" value="MOVE" /> Move
                </span>
              </label>
              <textarea
                name="description"
                placeholder="Describe your intent this turn..."
                required
                rows={3}
                className="field"
                style={{ background: "var(--field-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 10px", color: "var(--text)", fontFamily: "inherit" }}
              />
              <button type="submit" className="btn self-start">
                Submit
              </button>
            </form>
          )}
        </section>
      )}

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
