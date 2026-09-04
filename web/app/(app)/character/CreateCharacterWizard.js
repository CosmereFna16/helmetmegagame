"use client";

import FormError from "@/app/components/FormError";
import CheckField from "@/app/components/CheckField";
import { useEffect, useMemo, useRef, useState } from "react";
import { createCharacter, reserveRoleAction } from "./createActions";
import PointBuy from "../../components/PointBuy";
import {
  computeBudget,
  formatCost,
  costColor,
  tagsById as buildTagsById,
  effectiveTotalCost,
  effectiveCost,
  negativeTagCount,
  negativeTagPoints,
} from "@/lib/characterCreation";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import InfoIcon from "@/app/components/InfoIcon";
import Tooltip from "@/app/components/Tooltip";
import Select from "@/app/components/Select";
import {
  NAME_LIMITS,
  AGE_MIN,
  AGE_MAX,
  formatCharacterName,
  earnedTitles,
  GENDERS,
  GENDER_LABELS,
} from "@/lib/characterName";
import { randomCharacterName } from "@/lib/nameCorpus";
import { ANTAGONISTS, antagonistNames } from "@/lib/threats";

// Identity comes AFTER Role and Tags, and has to: a title is earned from the
// role you took and the tags you hold (db/lib/titles.js), so there is nothing
// to offer until both are picked. It also fixes the dynasty last name, which
// is locked by the role and so could never be applied while Identity ran
// first.
const STEPS = ["Role", "Tags", "Identity", "Antagonists", "Confirm"];
// Derived rather than written out: a hardcoded index for the footer's
// "is this the last step?" test would go stale the moment a step is
// inserted in the middle.
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
  // `cap` crosses from the server as null for an uncapped role (Infinity
  // doesn't survive serialization — see page.js). Comparing `taken >= cap`
  // against a raw null would coerce to 0 and read every uncapped role as
  // full, so the null check must stay explicit. Uncapped is never full.
  const full = cap !== null && taken >= cap;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(role.id)}
      aria-pressed={selected}
      className="select-card panel flex w-full flex-col gap-1 p-3 text-left"
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
        {/* A disabled card is otherwise just grey, which reads as a bug. This
            says the role is shut on purpose (GameConfig.playtestModeEnabled). */}
        {role.playtestLocked && <span className="chip">closed for this playtest</span>}
        {role.difficulty && <span className="chip">{role.difficulty}</span>}
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
  maxDrawbackTags,
  maxDrawbackPoints,
  playerCount,
  cursed,
  // The living Baron's surname, or null if nobody holds the seat yet. Only
  // read for a role whose `lastNameLocked` is set — see db/lib/dynasty.js.
  dynastyName = null,
}) {

  const [step, setStep] = useState(0);
  const [honorific, setHonorific] = useState("");
  // No default: the brief is "choose gender", so an unpicked "" blocks Next
  // rather than quietly filing everyone as NEUTRAL. Fixed for good once the
  // character exists.
  const [gender, setGender] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState("");
  const [roleId, setRoleId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  // Opt-in, so the empty array is the honest default — a player who walks past
  // the step has consented to nothing.
  const [antagonists, setAntagonists] = useState([]);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  // The banner sits above the step content, and both the role list and the
  // tag catalog are long enough to leave it well off the top of the screen.
  // "Role was taken while you were deciding" then looked like the Next button
  // simply doing nothing. Take the player to the message instead.
  const errorRef = useRef(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);
  // Set once the picked role is actually held server-side (see
  // reserveRoleAction), so the hold notice only shows a real claim rather
  // than the browsing state before Next is first hit on step 0.
  const [heldUntil, setHeldUntil] = useState(null);
  const [reserving, setReserving] = useState(false);

  const allRoles = useMemo(
    () => zones.flatMap((z) => z.factions.flatMap((f) => f.roles)),
    [zones],
  );
  const role = allRoles.find((r) => r.id === roleId) ?? null;

  const byId = useMemo(() => buildTagsById(tags), [tags]);
  const budget = computeBudget({ startingTagPoints, role, cursed });
  const selectedTags = tags.filter((t) => selectedIds.includes(t.id));
  const grantedTags = useMemo(
    () => (role ? tags.filter((t) => role.startingTagNames.includes(t.name)) : []),
    [role, tags],
  );
  const grantedIds = useMemo(() => grantedTags.map((t) => t.id), [grantedTags]);
  // Discounted by role grants, same as createActions' `spent` — the two must
  // agree or the wizard lets through a build the server rejects.
  const remaining = budget - effectiveTotalCost(selectedTags, byId, grantedIds);
  // Only what's bought here counts against the cap — a role's free drawback
  // (the Meister's Frail, the Headman's Old) lands as GM_GRANT and sits in
  // grantedTags, which this deliberately doesn't look at.
  // Two ceilings, and the build has to clear both — TAGS.md §4a.
  const drawbackCount = negativeTagCount(selectedTags);
  const drawbackPoints = negativeTagPoints(selectedTags);

  // Four seats fix their holder's gender rather than letting them choose:
  // Baron and Heir are men, Baroness and Successor are women. Same four roles
  // that hand down the dynasty surname, so both locks land on this step.
  // createCharacter stamps it over whatever the form posts, exactly as it does
  // the surname — the disabled control is only the hint.
  const lockedGender = role?.lockedGender ?? null;
  const effectiveGender = lockedGender ?? gender;

  // Which titles this build has earned, from the role and from every tag it
  // will end up holding — bought and role-granted alike. Recomputed as the
  // build changes, so buying Knighted on the Tags step puts Sir on the
  // Identity step behind it.
  //
  // ONE word per title, not three: gender picks the form, so a woman sees
  // Lady where a man sees Lord. Changing gender re-reads the whole list, which
  // is why it is in the deps.
  //
  // roles.yaml `starting_tags` lists display NAMES, so the granted half is
  // resolved through the catalog rather than used directly.
  const earned = useMemo(
    () =>
      earnedTitles({
        tagSlugs: [...grantedTags, ...selectedTags].map((t) => t.slug).filter(Boolean),
        roleSlug: role?.slug ?? null,
        gender: effectiveGender || "NEUTRAL",
      }),
    [grantedTags, selectedTags, role, effectiveGender],
  );

  // Switching roles changes the budget and what's already granted, so a
  // carried-over selection could silently be over budget or duplicate a
  // starting tag. Clearing is the honest reset.
  function pickRole(id) {
    setRoleId(id);
    setSelectedIds([]);
    // Browsing cards never claims a seat — only Next off step 0 does, below.
    // A stale hold from a role the player has since abandoned would be
    // misleading in the header.
    setHeldUntil(null);
  }

  // Claims (or extends) the held seat on the way out of step 0, and again on
  // every later Next so the 30-minute hold keeps sliding while the player is
  // still working the form — a slow tag menu should never cost the seat.
  // Re-validates server-side, same as createCharacter: the wizard's disabled
  // cards are the hint, not the lock.
  async function handleNext() {
    if (reserving) return;
    if (!roleId) {
      setStep((s) => s + 1);
      return;
    }
    setReserving(true);
    setError(null);
    try {
      const result = await reserveRoleAction(roleId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setHeldUntil(result?.expiresAt ?? null);
      setStep((s) => s + 1);
    } finally {
      setReserving(false);
    }
  }

  function toggleAntagonist(slug) {
    setAntagonists((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  // The role is already picked by the time Identity renders, so the last-name
  // input arrives correctly locked for one of the Baron's family rather than
  // being taken away after the fact. createCharacter stamps the dynasty name
  // regardless of what was typed, and this is what the preview shows.
  const lastNameLocked = role?.lastNameLocked === true;
  const effectiveLastName = lastNameLocked ? (dynastyName ?? "") : lastName;

  // Going back and dropping the tag that earned your title leaves the select
  // holding a word that is no longer on offer. Fall back to untitled rather
  // than posting something createCharacter would reject — this is the ONE
  // place a title is re-validated on its own, because the player is still
  // choosing it. Once the character exists, losing the tag never strips the
  // word (see normalizeEarnedHonorific).
  const effectiveHonorific = earned.includes(honorific) ? honorific : "";

  // Reads the chosen gender, so a woman gets a woman's name whether or not
  // she is titled. A locked last name is left untouched rather than rolled
  // and discarded (db/lib/nameCorpus.js), and NEUTRAL draws from both, which
  // is the honest answer rather than a fallback.
  function rollName() {
    const rolled = randomCharacterName({ gender: effectiveGender || "NEUTRAL", lastNameLocked });
    setFirstName(rolled.firstName);
    if (!lastNameLocked) setLastName(rolled.lastName ?? "");
  }

  // The player never sees a `title` here — it is GM-granted — so this is
  // exactly what their name will read as on creation.
  const displayName = formatCharacterName({
    honorific: effectiveHonorific,
    firstName,
    lastName: effectiveLastName,
  });

  // Same gate as createCharacter: one word each.
  const oneWord = (s) => s.trim().length > 0 && !/\s/.test(s.trim());
  const canAdvance =
    (step === 0 && role !== null) ||
    (step === 1 &&
      remaining >= 0 &&
      drawbackCount <= maxDrawbackTags &&
      drawbackPoints <= maxDrawbackPoints) ||
    // Gender is required and has no default, so it gates alongside the name.
    // A locked seat supplies it, so those players only have the name to fill.
    (step === 2 &&
      oneWord(firstName) &&
      (lastNameLocked || !lastName.trim() || oneWord(lastName)) &&
      Boolean(effectiveGender)) ||
    // Antagonists is optional: ticking nothing is a real answer, not an
    // unfinished one.
    step === 3 ||
    step === LAST_STEP;

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("firstName", firstName.trim());
    // Sent even when the seat locks it; createCharacter re-stamps from the
    // role either way, so this is the hint and that is the lock.
    fd.set("gender", effectiveGender);
    if (effectiveHonorific) fd.set("honorific", effectiveHonorific);
    // Deliberately not sent for a family seat — createCharacter would discard
    // it anyway, and posting it would imply otherwise.
    if (!lastNameLocked && lastName.trim()) fd.set("lastName", lastName.trim());
    if (age.trim()) fd.set("age", age.trim());
    fd.set("roleId", roleId);
    for (const id of selectedIds) fd.append("tagIds", id);
    for (const slug of antagonists) fd.append("antagonistOptIns", slug);
    // A successful create redirects, so anything RETURNED here is an error.
    // createCharacter rethrows whatever it doesn't recognise, from several
    // throw sites after the transaction commits (the audit row, the archive
    // event) plus pool contention on launch day, so the call must be
    // try/caught — an unhandled rejection would strand the button on
    // "Creating…" forever.
    try {
      const result = await createCharacter(fd);
      if (result?.error) setError(result.error);
    } catch (err) {
      // Safe to catch: redirect() throws on the SERVER and Next turns it into
      // a client-side navigation, so a successful create never rejects here.
      // The digest check is belt and braces — rethrowing a redirect would be
      // the one way to break the happy path.
      if (err?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
      console.error("Character creation failed:", err);
      setError("Something went wrong making your character. Try again — and tell a GM if it keeps failing.");
    } finally {
      // In a finally so the button always comes back. On the redirect path
      // this runs against a component that is going away, which is harmless.
      setPending(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title="Create Your Character" />
      <StepBar step={step} />

      {step > 0 && heldUntil && (
        <p className="text-sm text-muted">
          Held for you until{" "}
          {new Date(heldUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
        </p>
      )}

      {cursed && (
        <p className="panel p-3 text-sm text-accent">
          You&apos;re <strong>Cursed</strong>! Until someone buries your body or immortalizes your name, you can only be a Bum or a Migrant. You suffer -3 to starting points.
        </p>
      )}

      <div ref={errorRef}>
        <FormError>{error}</FormError>
      </div>

      {step === 0 && (
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

      {step === 1 && role && (
        <div className="flex flex-col gap-4">
          {/* Granted tags now live in PointBuy's build pane, so this header
              only names the role. */}
          <div className="panel flex flex-col gap-2 p-3 text-sm">
            <span>
              <strong>{role.name}</strong>
              <span className="text-muted"> — {role.factionName}</span>
            </span>
          </div>
          <PointBuy
            tags={tags}
            budget={budget}
            grantedTags={grantedTags}
            afterStartOnly={false}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            negativeCap={maxDrawbackTags}
            negativePointCap={maxDrawbackPoints}
            roleSlug={role.slug}
          />
        </div>
      )}

      {step === 2 && (
        <div className="panel flex flex-col gap-4 p-4">
          {/* Gender comes first on this step because it decides the rest of
              it: which form of an earned title the picker below offers, and
              which pool Randomize draws a name from. */}
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
            <label className="field">
              <span className="field-label flex items-center gap-1.5">
                Gender
                <InfoIcon
                  text={
                    lockedGender
                      ? "Your seat fixes this — the Baron and the Heir are men, the Baroness and the Successor are women."
                      : "Chosen once, here. It can't be changed afterwards, and it decides which form of a title you wear — Lord, Lady or Noble."
                  }
                />
              </span>
              <Select
                value={effectiveGender}
                onChange={(e) => setGender(e.target.value)}
                disabled={Boolean(lockedGender)}
                required
              >
                <option value="">(choose)</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </Select>
            </label>
            <p className="self-end pb-2 text-sm text-muted">
              {lockedGender
                ? `The ${role?.name} is always ${GENDER_LABELS[lockedGender].toLowerCase()}.`
                : "Fixed once your character is made."}
            </p>
          </div>
          {/* The title stays narrow beside the two name inputs; it collapses
              to full width on a phone like every other grid in the app. */}
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1fr]">
            <label className="field">
              <span className="field-label flex items-center gap-1.5">
                Title
                <InfoIcon text="Titles are earned. Your role and the tags you took decide which ones you may be styled by — most of Ravenheart goes untitled." />
              </span>
              <Select
                value={effectiveHonorific}
                onChange={(e) => setHonorific(e.target.value)}
                disabled={earned.length === 0}
              >
                <option value="">(none)</option>
                {earned.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
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
          <p className="text-sm text-muted">One word each.</p>
          {lastNameLocked && (
            <p className="text-sm text-muted">
              You take the Baron&apos;s last name.
            </p>
          )}
          {earned.length === 0 && (
            <p className="text-sm text-muted">
              Your role and tags haven&apos;t earned you a title. Most people in
              Ravenheart have none — you can earn one in play.
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
              placeholder={`${AGE_MIN}\u2013${AGE_MAX} \u2014 fixed once set, so leave it for later if you'd like`}
            />
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="panel flex flex-col gap-4 p-4">
          <h2 className="panel-header">Antagonists (optional)</h2>
          <p className="text-sm text-muted">
            Threat roles are assigned after game start. You can select the ones you&apos;d be open to receiving here.
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
              <dt className="text-muted">Starts in</dt>
              <dd>
                {role.startingLocationName
                  ? `${role.startingLocationName}${role.startingZoneName ? `, ${role.startingZoneName}` : ""} ‡`
                  : "Nowhere yet ‡"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Resources</dt>
              <dd>{role.startingResources} ⬢</dd>
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
            onClick={handleNext}
            disabled={!canAdvance || reserving}
          >
            {reserving ? "Holding…" : "Next"}
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
