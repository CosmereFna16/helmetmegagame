"use client";

import CheckField from "@/app/components/CheckField";
import Switch from "@/app/components/Switch";
import InfoIcon from "@/app/components/InfoIcon";
import Select from "@/app/components/Select";
import { TITLE_WORDS, NAME_LIMITS, AGE_MIN, AGE_MAX, GENDERS, GENDER_LABELS } from "@/lib/characterName";

// Every scalar on the Character row a GM may set, in one tab.
//
// `status` is absent on purpose — Kill and Revive are microactions in the
// action bar, because both carry Discord side effects that a staged form
// field would have to replay at Apply time.
//
// A touched field is outlined so the GM can see at a glance what Apply is
// about to write; `edits` is the staged diff from DevPanel.
export default function IdentityTab({ staged, lastNameLocked, factions, locations, roles, edits, onField }) {
  const touched = (key) => (Object.hasOwn(edits, key) ? "field-dirty" : "");

  return (
    <>
      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Name</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Every title, not just the ones this character earned — a GM
              setting a title is the one path that should never be
              second-guessed (TAGS.md §3), and this is the only way to clear
              one whose owner can no longer re-select it. */}
          <label className="field">
            <span className="field-label flex items-center gap-1.5">
              Honorific
              <InfoIcon text="Ungated here. Players only see titles their role and tags earned them; you see all of them." />
            </span>
            <Select
              value={staged.honorific ?? ""}
              onChange={(e) => onField("honorific", e.target.value || null)}
              className={touched("honorific")}
            >
              <option value="">(none)</option>
              {TITLE_WORDS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </Select>
          </label>

          <label className="field">
            <span className="field-label">First name</span>
            <input
              value={staged.firstName ?? ""}
              maxLength={NAME_LIMITS.firstName}
              onChange={(e) => onField("firstName", e.target.value)}
              className={touched("firstName")}
            />
          </label>

          {/* The only place `title` is editable — the player's own form shows
              it disabled. It renders in quotes between the two names. */}
          <label className="field">
            <span className="field-label">Granted title</span>
            <input
              value={staged.title ?? ""}
              maxLength={NAME_LIMITS.title}
              placeholder={'renders as "the Blind"'}
              onChange={(e) => onField("title", e.target.value)}
              className={touched("title")}
            />
          </label>

          <label className="field">
            <span className="field-label flex items-center gap-1.5">
              Last name
              {lastNameLocked && (
                <InfoIcon text="Inherited from the Baron. Change it on his sheet and all three of his family follow." />
              )}
            </span>
            <input
              value={staged.lastName ?? ""}
              maxLength={NAME_LIMITS.lastName}
              disabled={lastNameLocked}
              onChange={(e) => onField("lastName", e.target.value)}
              className={touched("lastName")}
            />
          </label>

          {/* Editable here and nowhere else: a player chooses this once at
              creation and can never change it, so correcting a mistake is a
              GM job. Changing it moves which form of a title they are offered
              — a Lord becomes a Lady — but never rewrites the word they
              already wear. */}
          <label className="field">
            <span className="field-label flex items-center gap-1.5">
              Gender
              <InfoIcon text="Fixed for the player at creation; only you can change it. Four seats force it — Baron and Heir are men, Baroness and Successor women — but nothing here enforces that, so a deliberate exception is yours to make." />
            </span>
            <Select
              value={staged.gender ?? "NEUTRAL"}
              onChange={(e) => onField("gender", e.target.value)}
              className={touched("gender")}
            >
              {GENDERS.map((g) => (
                <option key={g} value={g}>{GENDER_LABELS[g]}</option>
              ))}
            </Select>
          </label>

          <label className="field">
            <span className="field-label">Age</span>
            <input
              type="number"
              min={AGE_MIN}
              max={AGE_MAX}
              value={staged.age ?? ""}
              onChange={(e) => onField("age", e.target.value === "" ? null : Number(e.target.value))}
              className={touched("age")}
            />
          </label>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Standing</h2>

        <label className="field">
          <span className="field-label">Role</span>
          <Select
            value={staged.roleId ?? ""}
            onChange={(e) => onField("roleId", e.target.value || null)}
            className={touched("roleId")}
          >
            <option value="">(none — keeps the free-text title below)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.factionName} / {r.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="field">
          <span className="field-label">Role title (ignored when a Role is picked above)</span>
          <input
            value={staged.roleTitle ?? ""}
            onChange={(e) => onField("roleTitle", e.target.value)}
            className={touched("roleTitle")}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Faction</span>
            <Select
              value={staged.factionId ?? ""}
              onChange={(e) => onField("factionId", e.target.value || null)}
              className={touched("factionId")}
            >
              <option value="">(none)</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </label>

          <div className="flex flex-col justify-end gap-2 text-sm">
            {/* Promoting through Apply demotes the faction's existing leader
                in the same transaction — writing isLeader bare is how a
                faction ends up with two. */}
            <CheckField
              checked={Boolean(staged.isLeader)}
              onChange={(e) => onField("isLeader", e.target.checked)}
            >
              Faction Leader
            </CheckField>
            <CheckField
              checked={Boolean(staged.isTreasurer)}
              onChange={(e) => onField("isTreasurer", e.target.checked)}
            >
              Faction Treasurer
            </CheckField>
          </div>
        </div>

        {/* Where they physically stand, and the whole of what they can see:
            Apply swaps the Location's Discord role, and the zone role with it
            when the two locations sit in different zones. Grouped by zone so
            the list reads like the map. */}
        <label className="field">
          <span className="field-label">Location</span>
          <Select
            value={staged.locationId ?? ""}
            onChange={(e) => onField("locationId", e.target.value || null)}
            className={touched("locationId")}
          >
            <option value="">(nowhere — grants no channel access) ‡</option>
            {locationsByZone(locations).map((group) => (
              <optgroup key={group.zoneId ?? "loose"} label={group.zoneName ?? "Unzoned ‡"}>
                {group.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Economy</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Resources</span>
            <input
              type="number"
              value={staged.resources ?? 0}
              onChange={(e) => onField("resources", Number(e.target.value))}
              className={touched("resources")}
            />
          </label>
          <label className="field">
            <span className="field-label flex items-center gap-1.5">
              Unspent tag points
              <InfoIcon text="May go negative on purpose — clamping it at zero would let a broke player take a drawback's points for free." />
            </span>
            <input
              type="number"
              value={staged.tagPoints ?? 0}
              onChange={(e) => onField("tagPoints", Number(e.target.value))}
              className={touched("tagPoints")}
            />
          </label>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Profile</h2>
        <label className="field">
          <span className="field-label">Appearance</span>
          <textarea
            rows={4}
            value={staged.appearance ?? ""}
            onChange={(e) => onField("appearance", e.target.value)}
            className={touched("appearance")}
          />
        </label>
        <Switch
          checked={Boolean(staged.turnPingOptIn)}
          onChange={(e) => onField("turnPingOptIn", e.target.checked)}
        >
          Wants the turn-advance ping
        </Switch>
      </section>
    </>
  );
}

// Locations arrive already ordered by zone then sortOrder, so grouping is one
// pass and the <optgroup> order follows docs/zones.yaml.
function locationsByZone(locations) {
  const groups = [];
  for (const l of locations ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.zoneId === l.zoneId) last.locations.push(l);
    else groups.push({ zoneId: l.zoneId, zoneName: l.zoneName, locations: [l] });
  }
  return groups;
}
