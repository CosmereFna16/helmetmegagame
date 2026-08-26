import BioForm from "./BioForm";
import DefaultEffortPanel from "./DefaultEffortPanel";
import GoalsPanel from "./GoalsPanel";
import StatusPanel from "./StatusPanel";
import TagsPanel from "./TagsPanel";
import EquipmentPanel from "./EquipmentPanel";
import CorpseLootPanel from "./CorpseLootPanel";
import RichText from "./RichText";
import FactionLink from "./FactionLink";
import PageShell from "@/app/components/PageShell";
import InfoIcon from "./InfoIcon";

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
  if (!openTurn) return <p className="text-sm text-muted">No turn is currently open.</p>;

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
        <p className="text-muted">Waiting on you to set Kind/Opposed and hit Confirm — check Discord DMs.</p>
      )}
      {currentAction.status === "PENDING_OPPOSED" && (
        <p className="text-muted">Waiting on you to say whether it&apos;s Opposed — check Discord DMs.</p>
      )}
      {currentAction.status === "PENDING" && (
        <p className="text-muted">Pending confirmation — check Discord DMs and hit Confirm to lock it in.</p>
      )}
      {currentAction.status === "CONFIRMED" && currentAction.moveReviewStatus !== "SOLVED" && (
        <p className="text-muted">
          Confirmed{formatRoll(currentAction)} — awaiting GM review.
        </p>
      )}
      {(currentAction.status === "ADJUDICATED" || currentAction.moveReviewStatus === "SOLVED") && (
        <p>
          <span className="text-positive">Solved</span>
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
  canHeal = false,
  healTargets = [],
  healParties = null,
  corpses = [],
  equipSlots = 6,
  avatarUploadsEnabled = false,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection = null,
  hasCustomAvatar = false,
  lastNameLocked = false,
}) {
  const isSelf = mode === "self";

  return (
    <PageShell width="wide">
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
          <p className="text-sm text-muted">
            {character.roleTitle ?? "No role"} —{" "}
            <FactionLink factionId={character.factionId} name={character.faction?.name ?? "No faction"} />
          </p>
        </div>
      </div>

      {/* Two explicit columns rather than letting panels flow into a grid.
          Flowed, the columns end ragged, because these panels differ a lot in
          height — the Bio form is several times the height of the status
          block. Assigning by weight (identity/status left, the tall Bio form
          right) keeps the two sides close in length at any content size. The
          avatar/identity header above spans both. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <StatusPanel
            character={character}
            isSelf={isSelf}
            openTurn={openTurn}
            parties={transferParties}
          />

          {!isSelf && currentAction && (
            <section className="panel p-4">
              <h2 className="panel-header">This turn</h2>
              <ActionStatus currentAction={currentAction} openTurn={openTurn} />
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
        {isSelf && (
          <section className="panel p-4">
            <h2 className="panel-header panel-header--with-icon">
              Bio
              <InfoIcon text="Your name and age are fixed once set. Ask a GM if either needs to change." />
            </h2>
            <BioForm
              character={character}
              lastNameLocked={lastNameLocked}
              avatarUploadsEnabled={avatarUploadsEnabled}
              portraitMakerEnabled={portraitMakerEnabled}
              portraitFantasyPartsEnabled={portraitFantasyPartsEnabled}
              portraitSelection={portraitSelection}
              hasCustomAvatar={hasCustomAvatar}
            />
          </section>
        )}

        {!isSelf && character.appearance && (
          <section className="panel p-4">
            <h2 className="panel-header">Appearance</h2>
            <p className="text-sm">
              <RichText text={character.appearance} />
            </p>
          </section>
        )}
        </div>
      </div>

      <EquipmentPanel
        characterTags={character.tags}
        slots={equipSlots}
        isSelf={isSelf}
      />

      <TagsPanel
        characterTags={character.tags}
        isSelf={isSelf}
        tagPoints={character.tagPoints}
        catalog={tagCatalog ?? []}
        resources={character.resources}
        otherCharacters={otherCharacters ?? []}
        currentTurn={openTurn?.number ?? null}
        selfId={character.id}
        canHeal={canHeal}
        healTargets={healTargets}
        healParties={healParties}
      />

      {isSelf && (
        <GoalsPanel
          desire={desire ?? null}
          desireCooldownUntilTurn={desireCooldownUntilTurn ?? null}
          fear={character.fear ?? null}
          fearSetTurnNumber={character.fearSetTurnNumber ?? null}
          fearLastFulfilledTurn={character.fearLastFulfilledTurn ?? null}
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

      {isSelf && (
        <CorpseLootPanel selfId={character.id} corpses={corpses} />
      )}
    </PageShell>
  );
}
