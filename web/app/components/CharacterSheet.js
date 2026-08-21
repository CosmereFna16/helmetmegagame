import { updateCharacterProfile } from "../(app)/character/actions";
import AppearanceField from "./AppearanceField";
import AvatarField from "./AvatarField";
import TagChip from "./TagChip";
import DefaultEffortPanel from "./DefaultEffortPanel";
import DesirePanel from "./DesirePanel";
import StatusPanel from "./StatusPanel";
import TagRequestButtons from "./TagRequestButtons";
import RichText from "./RichText";
import FactionLink from "./FactionLink";

// Fixed display order rather than alphabetical or catalog order — Status
// (Mood, buffs/debuffs) belongs near the top, ahead of General/Skills.
const CATEGORY_ORDER = ["Meta", "Status", "General", "Skills", "Assets"];

function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Groups the CharacterTag rows, not the bare Tags — the wrapper carries
// expiresTurn, which the mood countdown in StatusPanel needs.
function groupTagsByCategory(characterTags) {
  const groups = new Map();
  for (const ct of characterTags) {
    const category = ct.tag.category?.trim() || "Other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(ct);
  }
  return [...groups.entries()].sort(
    (a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]),
  );
}

// Raw d6 first, then the summed modifier (Mood ±1, Hunger -1) and the total —
// a GM reading this has to be able to tell a modified 5 from a natural 5.
function formatRoll(action) {
  if (action.diceRoll == null) return "";
  const mod = action.diceModifier ?? 0;
  if (!mod) return ` — rolled ${action.diceRoll}`;
  const sign = mod > 0 ? `+${mod}` : `${mod}`;
  return ` — rolled ${action.diceRoll} (${sign}) = ${action.diceRoll + mod}`;
}

function ActionStatus({ currentAction, openTurn }) {
  if (!openTurn) return <p className="text-sm" style={{ color: "var(--muted)" }}>No turn is currently open.</p>;

  if (!currentAction) return null;

  const kindLabel =
    currentAction.moveKind === "GAMBIT"
      ? "Gambit"
      : currentAction.moveKind === "ROUTINE"
        ? "Routine"
        : currentAction.type === "MOVE"
          ? "Move"
          : "Move";

  return (
    <div className="text-sm">
      <p className="mb-1">
        {kindLabel}
        {currentAction.opposed ? " (Opposed)" : ""}: {currentAction.description}
      </p>
      {currentAction.status === "PENDING_TYPE" && (
        <p style={{ color: "var(--muted)" }}>Waiting on you to set Kind/Opposed and hit Confirm — check Discord DMs.</p>
      )}
      {currentAction.status === "PENDING_OPPOSED" && (
        <p style={{ color: "var(--muted)" }}>Waiting on you to say whether it&apos;s Opposed — check Discord DMs.</p>
      )}
      {currentAction.status === "PENDING" && (
        <p style={{ color: "var(--muted)" }}>Pending confirmation — check Discord DMs and hit Confirm to lock it in.</p>
      )}
      {currentAction.status === "CONFIRMED" && currentAction.moveReviewStatus !== "SOLVED" && (
        <p style={{ color: "var(--muted)" }}>
          Confirmed{formatRoll(currentAction)} — awaiting GM review.
        </p>
      )}
      {(currentAction.status === "ADJUDICATED" || currentAction.moveReviewStatus === "SOLVED") && (
        <p>
          <span style={{ color: "var(--positive)" }}>Solved</span>
        </p>
      )}
    </div>
  );
}

export default function CharacterSheet({
  character,
  mode,
  currentAction,
  openTurn,
  avatarSrc,
  transferParties,
  tagCatalog,
  otherCharacters,
  desire,
  desireCooldownUntilTurn,
}) {
  const isSelf = mode === "self";
  const tagGroups = groupTagsByCategory(character.tags);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 sm:p-8">
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
            style={{ background: "var(--field-bg)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
          />
        )}
        <div>
          <h1 className="text-2xl font-bold">{character.name}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {character.roleTitle ?? "No role"} —{" "}
            <FactionLink factionId={character.factionId} name={character.faction?.name ?? "No faction"} />
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {isSelf && (
          <section className="panel p-4">
            <h2 className="mb-3 font-bold">Bio</h2>
            <form action={updateCharacterProfile} encType="multipart/form-data" className="flex flex-col gap-3">
              <label className="field">
                <span className="field-label">Name</span>
                <input name="name" defaultValue={character.name} required />
              </label>
              <AvatarField
                defaultTurnPingOptIn={character.turnPingOptIn}
                defaultRomanceOptOut={character.romanceOptOut}
              />
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
            <p className="text-sm">
              <RichText text={character.appearance} />
            </p>
          </section>
        )}

        <StatusPanel
          character={character}
          isSelf={isSelf}
          openTurn={openTurn}
          parties={transferParties}
        />

      {!isSelf && currentAction && (
        <section className="panel p-4">
          <h2 className="mb-2 font-bold">This turn</h2>
          <ActionStatus currentAction={currentAction} openTurn={openTurn} />
        </section>
      )}
      </div>

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold">Tags</h2>
          {isSelf && (
            <TagRequestButtons
              catalog={tagCatalog ?? []}
              characterTags={character.tags}
              resources={character.resources}
              otherCharacters={otherCharacters ?? []}
            />
          )}
        </div>
        {tagGroups.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No tags yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {tagGroups.map(([category, tags]) => (
              <div key={category}>
                <p className="field-label mb-1">{category}</p>
                <ul className="flex flex-wrap gap-2">
                  {tags.map((ct) => (
                    <li key={ct.tag.id}>
                      <TagChip tag={ct.tag} quantity={ct.quantity} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {isSelf && (
        <DesirePanel
          desire={desire ?? null}
          cooldownUntilTurn={desireCooldownUntilTurn ?? null}
          openTurnNumber={openTurn?.number ?? null}
        />
      )}

      {isSelf && (
        <DefaultEffortPanel
          characterId={character.id}
          defaultEffort={character.defaultEffort ?? null}
          location={character.location ?? null}
        />
      )}
    </div>
  );
}
