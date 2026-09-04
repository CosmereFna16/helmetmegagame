"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Modal from "./Modal";
import Select from "./Select";
import CharacterLink from "./CharacterLink";
import EmptyState, { EmptyRow } from "./EmptyState";
import RequestDialog from "./RequestDialog";
import CheckField from "./CheckField";
import { useConfirm } from "./ConfirmProvider";
import { useTableState, SortHeader, FilterBar } from "./DataTable";
import Pager from "./Pager";
import FormError from "./FormError";
import { useRefresh } from "./useRefresh";
import {
  leaveFaction,
  removeMember,
  applyToFaction,
  inviteToFaction,
  withdrawApplication,
  decideApplication,
  renameFaction,
  secedeFaction,
  foundFaction,
  setSiloRoom,
  setMemberTreasurer,
} from "@/app/(app)/faction/actions";

// The faction console. See docs/systemdocs/FACTIONS.md.
//
// Same shape as the Depot's (DepotConsole.js), for the same reason: a strip of
// state that never leaves the screen, tabs underneath. What a member needs to
// know at a glance is who leads, where the faction banks, and whether anyone
// is waiting on an answer — and none of those belong behind a tab, because
// each of them is the reason you opened the page.
//
// Nothing here is authoritative. Every hidden tab and disabled button is a
// hint; the actions re-resolve the acting character from the session and
// re-check the officer seat inside their own transactions.

const DIRECTORY_SEARCH = [(f) => f.name, (f) => f.leaderName ?? ""];

const ALL_TABS = [
  { key: "roster", label: "Roster" },
  { key: "silo", label: "Silo" },
  { key: "applications", label: "Applications", officerOnly: true },
  { key: "standing", label: "Standing" },
];

// Informational only. An ERROR goes through FormError instead, which carries
// the role="alert" its own comment calls non-optional — this one has none, so
// a failed action would have been silent to a screen reader.
function Notice({ children, tone }) {
  return <p className={tone === "danger" ? "console-notice console-notice-danger" : "console-notice"}>{children}</p>;
}

// --- Roster -----------------------------------------------------------------

function RosterTab({ faction, isOfficer, isLeader, meId, run, pending }) {
  const confirm = useConfirm();
  return (
    <section className="panel overflow-x-auto p-4">
      <h2 className="panel-header">Members ({faction.members.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            {/* Role is same-faction knowledge, not officer authority — this
                roster is already scoped to your faction (FACTIONS.md §4a). */}
            <th>Name</th>
            <th>Role</th>
            {isOfficer && <th>Resources</th>}
            {isOfficer && <th />}
          </tr>
        </thead>
        <tbody>
          {/* Death is deliberately absent here. A dead member reads as an
              ordinary row, so finding out is a matter of the fiction rather
              than a broadcast every member sees on login. Catatonic is the
              exception: it is a visible tag whose entire job is telling the
              faction somebody is away. */}
          {faction.members.map((c) => (
            <tr key={c.id}>
              <td>
                <CharacterLink characterId={c.id} name={c.name} />
                {c.isLeader ? " (Leader)" : ""}
                {c.isTreasurer ? " (Treasurer)" : ""}
                {c.catatonic && <span className="chip text-xs text-muted ml-2">Catatonic</span>}
              </td>
              <td>{c.roleTitle ?? "—"}</td>
              {isOfficer && <td className="mono">{c.resources} ⬢</td>}
              {isOfficer && (
                <td className="flex gap-2">
                  {isLeader && c.id !== meId && (
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={pending}
                      onClick={() => run(() => setMemberTreasurer({ characterId: c.id, grant: !c.isTreasurer }))}
                    >
                      {c.isTreasurer ? "Revoke Treasurer" : "Make Treasurer"}
                    </button>
                  )}
                  {c.id !== meId && !(c.isLeader && !isLeader) && (
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={pending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Remove ${c.name}?`,
                          message: `They go back to Unaffiliated and lose any office they hold here. They keep everything they are carrying. ‡`,
                          confirmLabel: "Remove them",
                        });
                        if (ok) run(() => removeMember({ characterId: c.id }));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {faction.members.length === 0 && <EmptyRow cols={isOfficer ? 4 : 2}>Nobody yet. ‡</EmptyRow>}
        </tbody>
      </table>
    </section>
  );
}

// --- Silo -------------------------------------------------------------------

function SiloTab({ faction, silo, isOfficer, rooms, run, pending }) {
  const confirm = useConfirm();
  const [picking, setPicking] = useState(false);
  const [roomId, setRoomId] = useState(faction.siloRoomId ?? "");

  if (!silo) {
    return (
      <section className="panel p-4 flex flex-col gap-3">
        <EmptyState>
          {faction.name} banks nowhere. A silo is just a room somebody picked — everything in it
          stays where it is if you pick another one. ‡
        </EmptyState>
        {isOfficer && (
          <div>
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              Choose a silo
            </button>
          </div>
        )}
        {picking && <SiloPicker />}
      </section>
    );
  }

  return (
    <section className="panel p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="panel-header">
          {silo.name} <span className="text-muted">· {silo.locationName}</span>
        </h2>
        <span className="mono">{silo.resources == null ? "—" : `${silo.resources} ⬢`}</span>
      </div>

      {/* The two things a member has to be told, in priority order. */}
      {!silo.inZone ? (
        <Notice>
          The silo is in {silo.zoneName}. You can put things in from anywhere in that zone, and you
          have to be standing in {silo.name} to take anything out. ‡
        </Notice>
      ) : !silo.canOpen ? (
        <Notice tone="danger">
          {silo.name} is locked to you. You can still hand things in from anywhere in {silo.zoneName}
          {" "}— but you will not be able to take them back out, or see what is in there. ‡
        </Notice>
      ) : null}

      {silo.canOpen ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Stored</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {silo.tags.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono">{t.quantity}</td>
              </tr>
            ))}
            {silo.tags.length === 0 && <EmptyRow cols={2}>Nothing but the ⬢. ‡</EmptyRow>}
          </tbody>
        </table>
      ) : null}

      <p className="text-sm text-muted">
        Moving things is the Transfer dialog on your{" "}
        <Link href="/character" className="link">
          character sheet
        </Link>
        . The silo sits at the top of the destination list. ‡
      </p>

      {isOfficer && (
        <div>
          <button type="button" className="btn-quiet" onClick={() => setPicking(true)}>
            Change silo
          </button>
        </div>
      )}
      {picking && <SiloPicker />}
    </section>
  );

  function SiloPicker() {
    return (
      <Modal
        title="Where does the faction bank?"
        onClose={() => setPicking(false)}
        actions={
          <>
            <button type="button" className="btn-quiet" onClick={() => setPicking(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Re-point the silo?",
                  message:
                    "This moves nothing. Whatever is in the old room stays in the old room — somebody has to carry it. ‡",
                  confirmLabel: "Re-point it",
                });
                if (!ok) return;
                const done = await run(() => setSiloRoom({ roomId: roomId || null }));
                if (done) setPicking(false);
              }}
            >
              Set silo
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">Room</span>
          <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">No silo</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.zoneName} · {r.locationName} · {r.name}
                {r.locked ? " (locked)" : ""}
              </option>
            ))}
          </Select>
        </label>
        <p className="text-sm text-muted mt-2">
          A locked room still takes deposits from anyone in the faction. Only people holding its key
          can open it again, so pick one deliberately. ‡
        </p>
      </Modal>
    );
  }
}

// --- Applications -----------------------------------------------------------

function ApplicationsTab({ faction, applications, invites, siloKeys, candidates, run, pending }) {
  const [inviting, setInviting] = useState(false);
  const [inviteId, setInviteId] = useState("");
  const [grantKey, setGrantKey] = useState(siloKeys.length === 1 ? siloKeys[0].slug : "");

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="panel-header">People asking to join ({applications.length})</h2>
          <button type="button" className="btn-quiet" onClick={() => setInviting(true)}>
            Invite somebody
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>They said</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>
                  <CharacterLink characterId={a.characterId} name={a.characterName} />
                </td>
                <td className="text-muted">{a.note || "—"}</td>
                <td className="flex gap-2">
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        decideApplication({
                          applicationId: a.id,
                          accept: true,
                          grantTagSlug: grantKey || null,
                        }),
                      )
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={pending}
                    onClick={() => run(() => decideApplication({ applicationId: a.id, accept: false }))}
                  >
                    Decline
                  </button>
                </td>
              </tr>
            ))}
            {applications.length === 0 && <EmptyRow cols={3}>Nobody is knocking. ‡</EmptyRow>}
          </tbody>
        </table>

        {/* Accepting somebody into a faction whose silo is behind a key hands
            them a home they cannot find. The checkbox is here rather than
            buried in the accept dialog because forgetting it is the whole
            failure mode. */}
        {siloKeys.length > 0 && applications.length > 0 && (
          <div className="mt-3">
            {siloKeys.map((k) => (
              <CheckField
                key={k.slug}
                checked={grantKey === k.slug}
                onChange={(e) => setGrantKey(e.target.checked ? k.slug : "")}
              >
                Hand them {k.name} on accept — without it they can&apos;t reach the silo. ‡
              </CheckField>
            ))}
          </div>
        )}
      </section>

      <section className="panel p-4">
        <h2 className="panel-header">Invitations we&apos;ve sent ({invites.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>We said</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((a) => (
              <tr key={a.id}>
                <td>
                  <CharacterLink characterId={a.characterId} name={a.characterName} />
                </td>
                <td className="text-muted">{a.note || "—"}</td>
                <td>
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={pending}
                    onClick={() => run(() => withdrawApplication({ applicationId: a.id }))}
                  >
                    Withdraw
                  </button>
                </td>
              </tr>
            ))}
            {invites.length === 0 && <EmptyRow cols={3}>None outstanding. ‡</EmptyRow>}
          </tbody>
        </table>
      </section>

      <RequestDialog
        modeless
        open={inviting}
        title={`Invite somebody to ${faction.name}`}
        submitLabel="Send the invitation"
        busy={pending}
        reasonRequired={false}
        canSubmit={Boolean(inviteId)}
        onCancel={() => setInviting(false)}
        onConfirm={async (note) => {
          const done = await run(() => inviteToFaction({ characterId: inviteId, note }));
          if (done) {
            setInviting(false);
            setInviteId("");
          }
        }}
      >
        <label className="field">
          <span className="field-label">Character</span>
          <Select value={inviteId} onChange={(e) => setInviteId(e.target.value)}>
            <option value="">Choose somebody…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.factionName ? ` — ${c.factionName}` : ""}
              </option>
            ))}
          </Select>
        </label>
        <p className="text-sm text-muted mt-2">
          They get a DM and answer it on their own faction page. Nothing happens to them until they
          say yes. ‡
        </p>
      </RequestDialog>
    </div>
  );
}

// --- Standing ---------------------------------------------------------------

function StandingTab({ faction, isLeader, myApplications, run, pending }) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [founding, setFounding] = useState(false);
  const [name, setName] = useState(faction.name);
  const [newName, setNewName] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-4 flex flex-col gap-2 text-sm">
        <h2 className="panel-header">Standing</h2>
        <p>
          {faction.parentName ? (
            <>
              {faction.name} answers to <strong>{faction.parentName}</strong>. ‡
            </>
          ) : (
            <>{faction.name} answers to nobody. ‡</>
          )}
        </p>
        {faction.subjectNames.length > 0 && (
          <p className="text-muted">Subject to it: {faction.subjectNames.join(", ")}. ‡</p>
        )}
      </section>

      {myApplications.length > 0 && (
        <section className="panel p-4">
          <h2 className="panel-header">Waiting on you</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Faction</th>
                <th>They said</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {myApplications.map((a) => (
                <tr key={a.id}>
                  <td>{a.factionName}</td>
                  <td className="text-muted">{a.note || "—"}</td>
                  <td className="flex gap-2">
                    {a.kind === "INVITE" ? (
                      <>
                        <button
                          type="button"
                          className="btn-quiet"
                          disabled={pending}
                          onClick={() => run(() => decideApplication({ applicationId: a.id, accept: true }))}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn-quiet"
                          disabled={pending}
                          onClick={() => run(() => decideApplication({ applicationId: a.id, accept: false }))}
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={pending}
                        onClick={() => run(() => withdrawApplication({ applicationId: a.id }))}
                      >
                        Withdraw
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel p-4 flex flex-wrap gap-2">
        {isLeader && (
          <button type="button" className="btn-quiet" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
        {isLeader && faction.parentName && (
          <button
            type="button"
            className="btn-quiet"
            disabled={pending}
            onClick={async () => {
              const ok = await confirm({
                title: `Secede from ${faction.parentName}?`,
                message: `${faction.name} stops answering to them. Nobody moves, nothing is lost, and their Leader will be told. ‡`,
                confirmLabel: "Secede",
              });
              if (ok) run(() => secedeFaction());
            }}
          >
            Secede from {faction.parentName}
          </button>
        )}
        {/* Founding works from inside a faction too — foundFaction detaches
            you on the way out. Leaving first and then founding was two steps
            for one decision. */}
        <button type="button" className="btn-quiet" onClick={() => setFounding(true)}>
          Found your own
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={pending}
          onClick={async () => {
            const ok = await confirm({
              title: `Leave ${faction.name}?`,
              message: isLeader
                ? "You lose the Leader's seat, and the longest-standing member takes it. You keep everything you are carrying, but the silo stops being yours. ‡"
                : "You keep everything you are carrying, but the silo stops being yours. ‡",
              confirmLabel: "Walk out",
            });
            if (ok) run(() => leaveFaction());
          }}
        >
          Leave {faction.name}
        </button>
      </section>

      <RequestDialog
        modeless
        open={renaming}
        title={`Rename ${faction.name}`}
        submitLabel="Rename it"
        busy={pending}
        reasonRequired={false}
        canSubmit={name.trim().length >= 2}
        onCancel={() => setRenaming(false)}
        onConfirm={async () => {
          const done = await run(() => renameFaction({ name }));
          if (done) setRenaming(false);
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
        </label>
      </RequestDialog>

      <RequestDialog
        modeless
        open={founding}
        title="Found a faction"
        submitLabel="Found it"
        busy={pending}
        reasonRequired={false}
        canSubmit={newName.trim().length >= 2}
        onCancel={() => setFounding(false)}
        onConfirm={async () => {
          const done = await run(() => foundFaction({ name: newName }));
          if (done) {
            setFounding(false);
            setNewName("");
          }
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="field-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={48}
          />
        </label>
        <p className="text-sm text-muted mt-2">
          You leave {faction.name} and become the new faction&apos;s Leader. It starts with nobody
          else in it, no silo and no standing. ‡
        </p>
      </RequestDialog>
    </div>
  );
}

// --- Unaffiliated: the directory --------------------------------------------

// What a character with no faction sees. This used to be a dead end reading
// "You aren't assigned to a faction yet." with nothing to do about it.
function Directory({ directory, myApplications, run, pending }) {
  const [applying, setApplying] = useState(null);
  const [founding, setFounding] = useState(false);
  const [name, setName] = useState("");
  const pendingIds = new Set(myApplications.map((a) => a.factionId));
  // Founding is free and unlimited, so this list has no natural ceiling —
  // search and paging rather than a bare table that grows forever.
  const table = useTableState({
    rows: directory,
    searchFields: DIRECTORY_SEARCH,
    filterDefs: [],
    initialSort: { key: "name", dir: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="panel overflow-x-auto p-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="panel-header">Factions</h2>
          <button type="button" className="btn-quiet" onClick={() => setFounding(true)}>
            Found your own
          </button>
        </div>
        <FilterBar
          filterDefs={[]}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search factions"
        />
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader label="Name" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <th>Leader</th>
              <SortHeader
                label="Members"
                sortKey="memberCount"
                sort={table.sort}
                onSort={table.toggleSort}
              />
              <th />
            </tr>
          </thead>
          <tbody>
            {table.pageRows.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{f.leaderName ?? "—"}</td>
                <td className="mono">{f.memberCount}</td>
                <td>
                  {pendingIds.has(f.id) ? (
                    <span className="text-muted text-sm">Waiting</span>
                  ) : (
                    <button type="button" className="btn-quiet" onClick={() => setApplying(f)}>
                      Apply
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {table.pageRows.length === 0 && <EmptyRow cols={4}>There are none yet. ‡</EmptyRow>}
          </tbody>
        </table>
        <Pager
          page={table.page}
          totalPages={table.totalPages}
          total={table.total}
          unit="factions"
          onPage={table.setPage}
        />
      </section>

      {myApplications.length > 0 && (
        <section className="panel p-4">
          <h2 className="panel-header">Waiting on an answer</h2>
          <table className="data-table">
            <tbody>
              {myApplications.map((a) => (
                <tr key={a.id}>
                  <td>{a.factionName}</td>
                  <td className="text-muted">{a.kind === "INVITE" ? "They invited you" : "You applied"}</td>
                  <td className="flex gap-2">
                    {a.kind === "INVITE" && (
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={pending}
                        onClick={() => run(() => decideApplication({ applicationId: a.id, accept: true }))}
                      >
                        Accept
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          a.kind === "INVITE"
                            ? decideApplication({ applicationId: a.id, accept: false })
                            : withdrawApplication({ applicationId: a.id }),
                        )
                      }
                    >
                      {a.kind === "INVITE" ? "Decline" : "Withdraw"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <RequestDialog
        modeless
        open={Boolean(applying)}
        title={`Apply to ${applying?.name ?? ""}`}
        submitLabel="Send it"
        busy={pending}
        reasonRequired={false}
        onCancel={() => setApplying(null)}
        onConfirm={async (note) => {
          const done = await run(() => applyToFaction({ factionId: applying.id, note }));
          if (done) setApplying(null);
        }}
      >
        <p className="text-sm text-muted">
          Their Leader and Treasurer get a DM. Say something worth reading — they can turn you
          down. ‡
        </p>
      </RequestDialog>

      <RequestDialog
        modeless
        open={founding}
        title="Found a faction"
        submitLabel="Found it"
        busy={pending}
        reasonRequired={false}
        canSubmit={name.trim().length >= 2}
        onCancel={() => setFounding(false)}
        onConfirm={async () => {
          const done = await run(() => foundFaction({ name }));
          if (done) {
            setFounding(false);
            setName("");
          }
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
        </label>
        <p className="text-sm text-muted mt-2">
          You become its Leader. It starts with nobody else in it, no silo and no standing — all of
          which are yours to arrange. ‡
        </p>
      </RequestDialog>
    </div>
  );
}

// --- The console ------------------------------------------------------------

export default function FactionConsole(props) {
  const {
    faction,
    silo,
    isOfficer,
    isLeader,
    meId,
    applications = [],
    invites = [],
    myApplications = [],
    directory = [],
    rooms = [],
    siloKeys = [],
    candidates = [],
  } = props;

  const [tab, setTab] = useState("roster");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const doRefresh = useRefresh();

  // The one submit wrapper. Returns whether it worked, so a dialog knows
  // whether to close itself.
  function run(fn) {
    return new Promise((resolve) => {
      setError(null);
      startTransition(async () => {
        const res = await fn();
        if (res && res.ok === false) {
          setError(res.error);
          resolve(false);
          return;
        }
        doRefresh();
        resolve(true);
      });
    });
  }

  if (!faction) {
    return (
      <div className="flex flex-col gap-4">
        <FormError>{error}</FormError>
        <Directory directory={directory} myApplications={myApplications} run={run} pending={pending} />
      </div>
    );
  }

  const tabs = ALL_TABS.filter((t) => !t.officerOnly || isOfficer);
  const current = tabs.some((t) => t.key === tab) ? tab : "roster";
  return (
    <div className="flex flex-col gap-4">
      <section className="panel console-strip">
        <div className="console-strip-head">
          <span className="console-title">{faction.name}</span>
          <span className="mono console-figure">
            {!silo ? "no silo" : silo.resources == null ? "locked" : `${silo.resources} ⬢`}
          </span>
        </div>
        <div className="console-strip-stats">
          <span className="console-stat">
            <span className="console-stat-label">Silo</span>
            <span>{silo ? `${silo.name} · ${silo.locationName}` : "—"}</span>
          </span>
          <span className="console-stat">
            <span className="console-stat-label">Leader</span>
            <span>{faction.leaderName ?? "None"}</span>
          </span>
          <span className="console-stat">
            <span className="console-stat-label">Members</span>
            <span className="mono">{faction.members.length}</span>
          </span>
          {isOfficer && applications.length > 0 && (
            <span className="console-stat">
              <span className="console-stat-label">Pending</span>
              <span className="mono">{applications.length}</span>
            </span>
          )}
        </div>
      </section>

      <FormError>{error}</FormError>

      <nav className="console-tabs" aria-label="Faction sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === current ? "console-tab console-tab-on" : "console-tab"}
            aria-current={t.key === current ? "page" : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "applications" && applications.length > 0 ? ` • ${applications.length}` : ""}
            {t.key === "standing" && myApplications.length > 0 ? ` • ${myApplications.length}` : ""}
          </button>
        ))}
      </nav>

      {current === "roster" && (
        <RosterTab
          faction={faction}
          isOfficer={isOfficer}
          isLeader={isLeader}
          meId={meId}
          run={run}
          pending={pending}
        />
      )}
      {current === "silo" && (
        <SiloTab
          faction={faction}
          silo={silo}
          isOfficer={isOfficer}
          rooms={rooms}
          run={run}
          pending={pending}
        />
      )}
      {current === "applications" && (
        <ApplicationsTab
          faction={faction}
          applications={applications}
          invites={invites}
          siloKeys={siloKeys}
          candidates={candidates}
          run={run}
          pending={pending}
        />
      )}
      {current === "standing" && (
        <StandingTab
          faction={faction}
          isLeader={isLeader}
          myApplications={myApplications}
          run={run}
          pending={pending}
        />
      )}
    </div>
  );
}
