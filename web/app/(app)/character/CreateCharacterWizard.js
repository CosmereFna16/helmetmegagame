"use client";

import FormError from "@/app/components/FormError";
import CheckField from "@/app/components/CheckField";
import { useMemo, useState } from "react";
import { createCharacter } from "./createActions";
import PointBuy from "../../components/PointBuy";
import {
  computeBudget,
  formatCost,
  costColor,
  tagsById as buildTagsById,
  effectiveTotalCost,
  effectiveCost,
} from "@/lib/characterCreation";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import InfoIcon from "@/app/components/InfoIcon";
import Tooltip from "@/app/components/Tooltip";
import { WORST_FEAR_HELP } from "@/app/components/WorstFearPanel";
import { WORST_FEAR_PENALTY, WORST_FEAR_MAX_LENGTH } from "@/lib/constants";
import { HONORIFICS, NAME_LIMITS, AGE_MIN, AGE_MAX, formatCharacterName } from "@/lib/characterName";
import { randomCharacterName } from "@/lib/nameCorpus";
import { ANTAGONISTS, antagonistNames } from "@/lib/antagonists";

const STEPS = ["Identity", "Role", "Tags", "Fear", "Antagonists", "Confirm"];
// Derived rather than written out: the footer's "is this the last step?" test
// used to be a hardcoded index, which is exactly what goes stale the moment a
// step is inserted in the middle.
const LAST_STEP = STEPS.length - 1;

function StepBar({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className="chip"
          aria-current={i === step ? "step" : undefined}
          style={{
            color: i === step ? "var(--text)" : "var(--muted)",
            borderColor: i === step ? "var(--accent)" : undefined,
          }}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function RoleCard({ role, cap, taken, selected, disabled, onSelect }) {
  const full = taken >= cap;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(role.id)}
      aria-pressed={selected}
      className="panel flex w-full flex-col gap-1 p-3 text-left"
      style={{
        outline: selected ? "1px solid var(--accent-text)" : undefined,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>
          {role.name}
          {role.grantsLeader && <Tooltip text="Leader"> ★</Tooltip>}
        </strong>
        <span className="text-sm" style={{ color: full ? "var(--accent-text)" : "var(--muted)" }}>
          {taken}/{cap === null ? "∞" : cap}
        </span>
      </span>
      {role.intro && (
        <span className="text-sm text-muted">
          {role.intro}
        </span>
      )}
      <span className="flex flex-wrap gap-2 text-xs text-muted">
        {role.difficulty && <span className="chip">{role.difficulty}</span>}
        {role.startingLocationName && <span className="chip">{role.startingLocationName}</span>}
        {role.extraStartingPoints > 0 && (
          <span className="chip text-positive">
            +{role.extraStartingPoints} pts
          </span>
        )}
      </span>
    </button>
  );
}

export default function CreateCharacterWizard({
  zones,
  tags,
  startingTagPoints,
  playerCount,
  cursed,
  // The living Baron's surname, or null if nobody holds the seat yet. Only
  // read for a role whose `lastNameLocked` is set — see db/lib/dynasty.js.
  dynastyName = null,
}) {

  const [step, setStep] = useState(0);
  const [honorific, setHonorific] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState("");
  const [preferredNickname, setPreferredNickname] = useState("");
  const [roleId, setRoleId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [worstFear, setWorstFear] = useState("");
  // Opt-in, so the empty array is the honest default — a player who walks past
  // the step has consented to nothing.
  const [antagonists, setAntagonists] = useState([]);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const allRoles = useMemo(
    () => zones.flatMap((z) => z.factions.flatMap((f) => f.roles)),
    [zones],
  );
  const role = allRoles.find((r) => r.id === roleId) ?? null;

  const byId = useMemo(() => buildTagsById(tags), [tags]);
  const budget = computeBudget({ startingTagPoints, role, cursed });
  const selectedTags = tags.filter((t) => selectedIds.includes(t.id));
  const remaining = budget - effectiveTotalCost(selectedTags, byId);
  const grantedTags = useMemo(
    () => (role ? tags.filter((t) => role.startingTagNames.includes(t.name)) : []),
    [role, tags],
  );
  const grantedIds = useMemo(() => grantedTags.map((t) => t.id), [grantedTags]);

  // Switching roles changes the budget and what's already granted, so a
  // carried-over selection could silently be over budget or duplicate a
  // starting tag. Clearing is the honest reset.
  function pickRole(id) {
    setRoleId(id);
    setSelectedIds([]);
  }

  function toggleAntagonist(slug) {
    setAntagonists((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  // Identity comes before Role, so the last-name input is live on the first
  // pass through. Picking one of the Baron's family retroactively takes it
  // away: createCharacter ignores whatever was typed and stamps the dynasty
  // name instead, so that is what the preview has to show from here on.
  const lastNameLocked = role?.lastNameLocked === true;
  const effectiveLastName = lastNameLocked ? (dynastyName ?? "") : lastName;

  // Reads the honorific currently in the dropdown, so switching to Lady and
  // rolling again gives a woman's name. A locked last name is left untouched
  // rather than rolled and discarded — see db/lib/nameCorpus.js.
  function rollName() {
    const rolled = randomCharacterName({ honorific, lastNameLocked });
    setFirstName(rolled.firstName);
    if (!lastNameLocked) setLastName(rolled.lastName ?? "");
  }

  // The player never sees a `title` here — it is GM-granted — so this is
  // exactly what their name will read as on creation.
  const displayName = formatCharacterName({
    honorific,
    firstName,
    lastName: effectiveLastName,
  });

  const canAdvance =
    (step === 0 && firstName.trim().length > 0) ||
    (step === 1 && role !== null) ||
    (step === 2 && remaining >= 0) ||
    // The Worst Fear step is optional — you may walk straight past it and set
    // one later — so there is nothing to gate on.
    step === 3 ||
    // Antagonists likewise: ticking nothing is a real answer, not an unfinished
    // one.
    step === 4 ||
    step === LAST_STEP;

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("firstName", firstName.trim());
    if (honorific) fd.set("honorific", honorific);
    // Deliberately not sent for a family seat — createCharacter would discard
    // it anyway, and posting it would imply otherwise.
    if (!lastNameLocked && lastName.trim()) fd.set("lastName", lastName.trim());
    if (age.trim()) fd.set("age", age.trim());
    if (preferredNickname.trim()) fd.set("preferredNickname", preferredNickname.trim());
    fd.set("roleId", roleId);
    for (const id of selectedIds) fd.append("tagIds", id);
    if (worstFear.trim()) fd.set("worstFear", worstFear.trim());
    for (const slug of antagonists) fd.append("antagonistOptIns", slug);
    // A successful create redirects, so anything returned here is an error.
    const result = await createCharacter(fd);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title="Create Your Character" />
      <StepBar step={step} />

      {cursed && (
        <p className="panel p-3 text-sm text-accent">
          You&apos;re <strong>Cursed</strong>! You can only be a Bum or a Migrant, and you suffer -3 to
          starting points. Wait until someone buries your body.
        </p>
      )}

      <FormError>{error}</FormError>

      {step === 0 && (
        <div className="panel flex flex-col gap-4 p-4">
          {/* Honorific stays narrow beside the two name inputs; it collapses
              to full width on a phone like every other grid in the app. */}
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1fr]">
            <label className="field">
              <span className="field-label">Title</span>
              <select value={honorific} onChange={(e) => setHonorific(e.target.value)}>
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
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={NAME_LIMITS.firstName}
                autoFocus
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
                value={lastNameLocked ? effectiveLastName : lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={NAME_LIMITS.lastName}
                placeholder={lastNameLocked ? "No dynasty name yet" : undefined}
                disabled={lastNameLocked}
              />
            </label>
          </div>
          {lastNameLocked && (
            <p className="text-sm text-muted">
              You are of the Baron&apos;s house, so you take his last name rather than one
              of your own.
            </p>
          )}
          {/* The only place a player sees the join rule before submitting, and
              where Randomize sits so a roll and its result read as one line. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {displayName ? `You will be known as ${displayName}.` : ""}
            </p>
            <button type="button" className="btn-secondary" onClick={rollName}>
              Randomize
            </button>
          </div>
          <label className="field">
            <span className="field-label">Age (optional)</span>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              min={AGE_MIN}
              max={AGE_MAX}
              placeholder={`${AGE_MIN}\u2013${AGE_MAX} \u2014 fixed once set, so you may leave it for later`}
            />
          </label>
          <label className="field">
            <span className="field-label">Preferred nickname (optional)</span>
            <input
              value={preferredNickname}
              onChange={(e) => setPreferredNickname(e.target.value)}
              placeholder="Shown before your character name in Discord"
              maxLength={32}
            />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-6">
          {zones.map((zone) => (
            <section key={zone.id} className="flex flex-col gap-3">
              <h2 className="panel-header">{zone.name}</h2>
              {zone.factions.map((faction) => (
                <div key={faction.id} className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-muted">
                    {faction.name}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {faction.roles.map((r) => (
                      <RoleCard
                        key={r.id}
                        role={r}
                        cap={r.cap}
                        taken={r.taken}
                        selected={r.id === roleId}
                        disabled={!r.selectable || (r.cap !== null && r.taken >= r.cap)}
                        onSelect={pickRole}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {step === 2 && role && (
        <div className="flex flex-col gap-4">
          <div className="panel flex flex-col gap-2 p-3 text-sm">
            <span>
              <strong>{role.name}</strong>
              <span className="text-muted"> — {role.factionName}</span>
            </span>
            {grantedTags.length > 0 && (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Granted free:</span>
                {grantedTags.map((t) => (
                  <span key={t.id} className="chip">
                    {t.name}
                  </span>
                ))}
              </span>
            )}
          </div>
          <PointBuy
            tags={tags}
            budget={budget}
            grantedTags={grantedTags}
            afterStartOnly={false}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        </div>
      )}

      {step === 3 && (
        <div className="panel flex flex-col gap-4 p-4">
          <h2 className="panel-header panel-header--with-icon">
            Worst Fear (optional)
            <InfoIcon text={WORST_FEAR_HELP} />
          </h2>
          <p className="text-sm text-muted">
            One dread your character carries. If it ever comes true you lose {WORST_FEAR_PENALTY}{" "}
            Tag Points — and you keep the fear, so it can come true again. You can skip this and
            name one later, but once it&apos;s set, changing it is a request a GM reviews.
          </p>
          <label className="field">
            <span className="field-label">What does your character dread?</span>
            <input
              value={worstFear}
              onChange={(e) => setWorstFear(e.target.value)}
              maxLength={WORST_FEAR_MAX_LENGTH}
              placeholder="Dying alone and unremembered…"
            />
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="panel flex flex-col gap-4 p-4">
          <h2 className="panel-header">Antagonists (optional)</h2>
          <p className="text-sm text-muted">
            Some roles are handed out quietly by a GM rather than picked from the list — a
            Succubus, a Cultist, the Judge. Tick the ones you would be happy to be given.
            Leaving every box blank is a perfectly good answer, and ticking one is no promise
            you&apos;ll ever receive it. Nobody but a GM sees this, and it can&apos;t be changed
            later without asking one.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ANTAGONISTS.map((a) => (
              <CheckField
                key={a.slug}
                checked={antagonists.includes(a.slug)}
                onChange={() => toggleAntagonist(a.slug)}
              >
                {a.name}
              </CheckField>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-quiet"
              onClick={() => setAntagonists(ANTAGONISTS.map((a) => a.slug))}
            >
              Select all
            </button>
            <button type="button" className="btn-quiet" onClick={() => setAntagonists([])}>
              Clear
            </button>
            <span className="text-sm text-muted">
              {antagonists.length} of {ANTAGONISTS.length} selected
            </span>
          </div>
        </div>
      )}

      {step === LAST_STEP && role && (
        <div className="panel flex flex-col gap-3 p-4">
          <h2 className="panel-header">{displayName}</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Role</dt>
              <dd>{role.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Faction</dt>
              <dd>{role.factionName}</dd>
            </div>
            <div>
              <dt className="text-muted">Starts at</dt>
              <dd>{role.startingLocationName ?? "Nowhere yet"}</dd>
            </div>
            <div>
              <dt className="text-muted">Resources</dt>
              <dd>{role.startingResources} ⬢</dd>
            </div>
            <div>
              <dt className="text-muted">Worst Fear</dt>
              <dd>{worstFear.trim() || <span className="text-muted">none</span>}</dd>
            </div>
            <div>
              <dt className="text-muted">Open to</dt>
              <dd className="flex flex-wrap gap-2">
                {antagonists.length === 0 ? (
                  <span className="text-muted">no antagonist roles</span>
                ) : (
                  antagonistNames(antagonists).map((n) => (
                    <span key={n} className="chip">
                      {n}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Tags:</span>
            {[...grantedTags, ...selectedTags].map((t) => (
              <span key={t.id} className="chip">
                {t.name}
                {selectedIds.includes(t.id) &&
                  (() => {
                    const cost = effectiveCost(t, byId, grantedIds);
                    return <span style={{ color: costColor(cost) }}> {formatCost(cost)}</span>;
                  })()}
              </span>
            ))}
            {grantedTags.length + selectedTags.length === 0 && (
              <span className="text-muted">none</span>
            )}
          </div>
          <p className="text-sm text-muted">
            {remaining} unspent point{remaining === 1 ? "" : "s"} will carry over to your character.
          </p>
          {role.grantsLeader && (
            <p className="text-sm">You will start as your faction&apos;s <strong>Leader</strong>.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-quiet"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || pending}
        >
          Back
        </button>
        {step < LAST_STEP ? (
          <button
            type="button"
            className="btn"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance}
          >
            Next
          </button>
        ) : (
          <button type="button" className="btn" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Begin"}
          </button>
        )}
      </div>
    </PageShell>
  );
}
