import BioForm from "./BioForm";
import DefaultEffortPanel from "./DefaultEffortPanel";
import GoalsPanel from "./GoalsPanel";
import StatusPanel from "./StatusPanel";
import TagsPanel from "./TagsPanel";
import CorpseLootPanel from "./CorpseLootPanel";
import RichText from "./RichText";
import FactionLink from "./FactionLink";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import InfoIcon from "./InfoIcon";

// Raw d6 first, then the summed modifier (Hunger) and the total —
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
        {kindLabel}: {currentAction.description}
      </p>
      {currentAction.status === "PENDING_TYPE" && (
        <p className="text-muted">Waiting on you to set Kind and hit Confirm — check Discord DMs.</p>
      )}
      {currentAction.status === "PENDING_OPPOSED" && (
        <p className="text-muted">Pending confirmation — check Discord DMs and hit Confirm to lock it in.</p>
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

// The header's avatar, rendered into PageHeader's `actions` slot. A plain
// image rather than a button — the portrait maker and avatar upload live in
// the Bio panel below, not up here.
function Avatar({ avatarSrc, name }) {
  return avatarSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarSrc}
      alt={name}
      className="h-16 w-16 object-cover"
      style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
    />
  ) : (
    <div
      aria-hidden="true"
      className="h-16 w-16"
      style={{ background: "var(--field-bg)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
    />
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
  // The mid-game Store, folded into the Tags panel as a modal (see
  // TagsPanel.js / StorePanel.js). Absent on someone else's sheet.
  storeTags = null,
  storeHeldTags = null,
  storeNegativeCap = null,
  storeNegativeHeld = 0,
}) {
  const isSelf = mode === "self";

  return (
    <PageShell width="wide">
      <PageHeader
        title={character.name}
        subtitle={
          <>
            {character.roleTitle ?? "No role"} —{" "}
            <FactionLink factionId={character.factionId} name={character.faction?.name ?? "No faction"} />
          </>
        }
        actions={<Avatar avatarSrc={avatarSrc} name={character.name} />}
      />

      {/* Two real columns, not panels flowed by guessed height. The left
          column is the wide working column — tags/equipment first (what a
          player checks most), then the two small self-forms below it. The
          right column is a fixed-width rail that stays put while the left
          column scrolls past it, the same sticky treatment PointBuy.js uses
          for its own build-list aside. Below `md` both collapse into one
          stacked column, tags-and-status first since that's what a player on
          their phone actually wants — not a form. */}
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <StatusPanel character={character} isSelf={isSelf} parties={transferParties} />

          {!isSelf && currentAction && (
            <section className="panel p-4">
              <h2 className="panel-header">This turn</h2>
              <ActionStatus currentAction={currentAction} openTurn={openTurn} />
            </section>
          )}

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
            equipSlots={equipSlots}
            storeTags={storeTags}
            storeHeldTags={storeHeldTags}
            storeNegativeCap={storeNegativeCap}
            storeNegativeHeld={storeNegativeHeld}
          />

          {isSelf && (
            <GoalsPanel
              desire={desire ?? null}
              desireCooldownUntilTurn={desireCooldownUntilTurn ?? null}
              openTurnNumber={openTurn?.number ?? null}
            />
          )}

          {isSelf && (
            <DefaultEffortPanel
              characterId={character.id}
              defaultEffort={character.defaultEffort ?? null}
              zone={character.zone ?? null}
            />
          )}

          {isSelf && corpses.length > 0 && <CorpseLootPanel selfId={character.id} corpses={corpses} />}
        </div>

        <div className="flex flex-col gap-6 md:sticky md:top-4">
          {/* TODO(requests-panel): another agent is adding a Requests panel
              here, above Bio — this column is otherwise ready for it. */}

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
    </PageShell>
  );
}
