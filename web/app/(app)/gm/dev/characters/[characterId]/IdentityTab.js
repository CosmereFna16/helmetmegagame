"use client";

import InfoIcon from "@/app/components/InfoIcon";
import { HONORIFICS, NAME_LIMITS, AGE_MIN, AGE_MAX } from "@/lib/characterName";

// Every scalar on the Character row a GM may set, in one tab.
//
// `status` is absent on purpose — Kill and Revive are microactions in the
// action bar, because both carry Discord side effects that a staged form
// field would have to replay at Apply time.
//
// A touched field is outlined so the GM can see at a glance what Apply is
// about to write; `edits` is the staged diff from DevPanel.
export default function IdentityTab({ staged, lastNameLocked, factions, zones, roles, edits, onField }) {
  const touched = (key) => (Object.hasOwn(edits, key) ? { outline: "1px solid var(--accent)" } : undefined);

  return (
    <>
      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Name</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Honorific</span>
            <select
              value={staged.honorific ?? ""}
              onChange={(e) => onField("honorific", e.target.value || null)}
              style={touched("honorific")}
            >
              <option value="">(none)</option>
              {HONORIFICS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">First name</span>
            <input
              value={staged.firstName ?? ""}
              maxLength={NAME_LIMITS.firstName}
              onChange={(e) => onField("firstName", e.target.value)}
              style={touched("firstName")}
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
              style={touched("title")}
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
              style={touched("lastName")}
            />
          </label>

          <label className="field">
            <span className="field-label">Age</span>
            <input
              type="number"
              min={AGE_MIN}
              max={AGE_MAX}
              value={staged.age ?? ""}
              onChange={(e) => onField("age", e.target.value === "" ? null : Number(e.target.value))}
              style={touched("age")}
            />
          </label>

          <label className="field">
            <span className="field-label">Preferred nickname</span>
            <input
              value={staged.preferredNickname ?? ""}
              maxLength={32}
              placeholder="the {base} in their Discord nickname"
              onChange={(e) => onField("preferredNickname", e.target.value)}
              style={touched("preferredNickname")}
            />
          </label>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Standing</h2>

        <label className="field">
          <span className="field-label">Role</span>
          <select
            value={staged.roleId ?? ""}
            onChange={(e) => onField("roleId", e.target.value || null)}
            style={touched("roleId")}
          >
            <option value="">(none — keeps the free-text title below)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.factionName} / {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Role title (ignored when a Role is picked above)</span>
          <input
            value={staged.roleTitle ?? ""}
            onChange={(e) => onField("roleTitle", e.target.value)}
            style={touched("roleTitle")}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Faction</span>
            <select
              value={staged.factionId ?? ""}
              onChange={(e) => onField("factionId", e.target.value || null)}
              style={touched("factionId")}
            >
              <option value="">(none)</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-col justify-end gap-2 text-sm">
            {/* Promoting through Apply demotes the faction's existing leader
                in the same transaction — writing isLeader bare is how a
                faction ends up with two. */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(staged.isLeader)}
                onChange={(e) => onField("isLeader", e.target.checked)}
              />
              Faction Leader
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(staged.isTreasurer)}
                onChange={(e) => onField("isTreasurer", e.target.checked)}
              />
              Faction Treasurer
            </label>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Location</span>
          <select
            value={staged.locationId ?? ""}
            onChange={(e) => onField("locationId", e.target.value || null)}
            style={touched("locationId")}
          >
            <option value="">(none — grants no location channel access)</option>
            {zones.map((z) => (
              <optgroup key={z.id} label={z.name}>
                {z.locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Zone (only used when no Location is set)</span>
          <select
            value={staged.zoneId ?? ""}
            onChange={(e) => onField("zoneId", e.target.value || null)}
            style={touched("zoneId")}
          >
            <option value="">(none)</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
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
              style={touched("resources")}
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
              style={touched("tagPoints")}
            />
          </label>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">Profile</h2>
        <label className="field">
          <span className="field-label">Appearance / bio</span>
          <textarea
            rows={4}
            value={staged.appearance ?? ""}
            onChange={(e) => onField("appearance", e.target.value)}
            style={touched("appearance")}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(staged.turnPingOptIn)}
            onChange={(e) => onField("turnPingOptIn", e.target.checked)}
          />
          Wants the turn-advance ping
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(staged.romanceOptOut)}
            onChange={(e) => onField("romanceOptOut", e.target.checked)}
          />
          Opted out of romance plots
        </label>
      </section>
    </>
  );
}
