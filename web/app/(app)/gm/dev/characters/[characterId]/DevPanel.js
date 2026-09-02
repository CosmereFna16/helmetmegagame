"use client";

import { CHARACTER_STATUS } from "@/app/components/StatusPill";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRefresh } from "@/app/components/useRefresh";
import { PageHeader } from "@/app/components/PageShell";
import FactionLink from "@/app/components/FactionLink";
import TagPointsValue from "@/app/components/TagPointsValue";
import Modal from "@/app/components/Modal";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import ActionBar from "./ActionBar";
import IdentityTab from "./IdentityTab";
import TagEditor from "./TagEditor";
import TurnTab from "./TurnTab";
import GoalsTab from "./GoalsTab";
import RecordTab from "./RecordTab";
import { applyCharacterEdits } from "./actions";
import { getDevPanelRecord } from "@/app/components/devPanelActions";
import { useConfirm } from "@/app/components/ConfirmProvider";
import useDirtyGuard from "@/app/components/useDirtyGuard";
// The staged-op merge algebra, shared with the adjudication workspace's
// effect composer — see web/lib/tagOpAlgebra.js for the rules.
import { mergeTagOp } from "@/lib/tagOpAlgebra";

const TABS = ["Identity", "Tags", "Turn", "Goals", "Record"];

// The Dev Character Panel's shell: it owns the staged edit state, the tab, and
// the Apply/Cancel footer. Everything else is a presentational tab.
//
// Two kinds of interaction live here, and they are deliberately kept on
// DISJOINT fields so they can never race each other (docs/systemdocs/DEV-PANEL.md):
//
//   - Staged   — every editable value, plus every tag change. Held right here
//                until Apply sends them as one payload, one audit row.
//   - Immediate — the verbs in the action bar. Own confirm, own server action,
//                straight away.
//
// `status` is the field that would have straddled both, so it isn't in the
// form at all: Kill and Revive are microactions, and Apply reads status from
// the database rather than the payload. That is why Apply never has to reason
// about "did they also just kill this character".
export default function DevPanel({
  character,
  discord,
  lastNameLocked,
  canDelete,
  factions,
  transferRoster,
  locations,
  roles,
  tags,
  held,
  feed,
  cursed,
  equipSlots,
  maxDrawbackTags,
  startingTagPoints,
  openTurn,
  gambitModifier,
  stagedForPush,
  openTurnAction,
  defaultEffort,
  desires,
  desireSlots,
  desireSlotStates,
  desireCatalog,
  desireFamilies,
  desireCooldowns,
  // "page" is the standalone /gm/dev/characters/[characterId] route (the
  // default, unchanged). "modal" is the mount over /gm/turns
  // (DevPanelModal.js) — DevPanel owns the Modal itself rather than the
  // caller wrapping it, because the dirty state (staged edits) lives here,
  // and closing has to go through the same guard Apply/Cancel already use.
  frame = "page",
  onClose,
  onMutated,
  onDeleted,
}) {
  const [routeRefresh] = useRefresh();
  const confirm = useConfirm();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();
  // In "modal" frame, a microaction's refresh has to repaint the fetched
  // DTOs (onMutated), not the desk's own RSC — a route refresh alone would
  // leave the modal showing stale data. Either way the lazily-fetched Record
  // tab is client state neither path can reach, so it invalidates here.
  // (invalidateRecord is a function declaration below — hoisted, so this
  // closure may reference it before its line.)
  const refresh = () => {
    invalidateRecord();
    (onMutated ?? routeRefresh)();
  };
  const [tab, setTab] = useState("Identity");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  // The Record tab's 350 history rows are not in the props: they load on the
  // first click of that tab, from the tab button's own handler. Deliberately
  // NOT an effect — react-hooks/set-state-in-effect is an error in this repo,
  // and a click is the honest trigger anyway. null means "not asked for yet",
  // so the guard below also stops a second click re-fetching.
  const [record, setRecord] = useState(null);
  const [recordError, setRecordError] = useState(null);
  const recordLoading = useRef(false);

  function loadRecord() {
    if (recordLoading.current) return;
    recordLoading.current = true;
    // Clear a previous failure up front, so a retry that succeeds doesn't
    // leave the old error rendered above the loaded tables.
    setRecordError(null);
    getDevPanelRecord({ characterId: character.id })
      .then((res) => {
        if (res?.ok) setRecord(res.record);
        else setRecordError(res?.error ?? "Something went wrong.");
      })
      .catch((err) => setRecordError(err?.message ?? "Something went wrong."))
      .finally(() => {
        recordLoading.current = false;
      });
  }

  function openTab(next) {
    setTab(next);
    if (next === "Record" && !record) loadRecord();
  }

  // Every microaction writes an audit row (and some a DM), so a Record tab
  // fetched before the action is stale the moment it lands. Refetch if the
  // GM is looking at it; otherwise just drop it so the next click refetches.
  function invalidateRecord() {
    setRecord(null);
    if (tab === "Record") loadRecord();
  }

  // Staged core fields, keyed the same as the server's EDITABLE_FIELDS. Only
  // keys actually touched are sent, so an untouched field can never be
  // overwritten by a stale value read at page load.
  const [edits, setEdits] = useState({});
  // Staged tag ops, keyed by tagId — never characterTagId, which can vanish
  // under us when the expiry sweep runs at a turn close.
  const [tagOps, setTagOps] = useState(new Map());

  // An empty text input and a null column are the same thing to the server
  // (every string field goes through trimmedOrNull), so they have to compare
  // equal here too — otherwise typing into an empty field and deleting it
  // again leaves a phantom pending change that Apply would write as nothing.
  function same(a, b) {
    const norm = (v) => (v === "" || v == null ? null : v);
    return Object.is(norm(a), norm(b));
  }

  function setField(key, value) {
    setEdits((prev) => {
      const next = { ...prev };
      // Setting a field back to its stored value un-stages it rather than
      // sending a no-op, so the pending count stays honest.
      if (same(character[key], value)) delete next[key];
      else next[key] = value;
      return next;
    });
    markDirty();
  }

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  function stageTagOps(ops) {
    setTagOps((prev) => {
      const next = new Map(prev);
      for (const op of ops) {
        if (op == null) continue;
        if (op.op === "clear") {
          next.delete(op.tagId);
          continue;
        }
        // mergeTagOp needs the catalog flag: two "Add one" clicks accumulate
        // on a stackable tag and pin back to 1 on anything else.
        const stackable = !!tagById.get(op.tagId)?.stackable;
        next.set(op.tagId, mergeTagOp(next.get(op.tagId), op, { stackable }));
      }
      // A merge can cancel out entirely (add then remove) — drop those.
      for (const [tagId, op] of next) if (op == null) next.delete(tagId);
      return next;
    });
    markDirty();
  }

  const ops = useMemo(() => [...tagOps.values()], [tagOps]);
  const pendingCount = Object.keys(edits).length + ops.length;

  async function onCancel() {
    if (!pendingCount) return;
    const ok = await confirm({
      title: "Discard your changes?",
      message: `${pendingCount} pending change${pendingCount === 1 ? "" : "s"} will be reverted.`,
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
    });
    if (!ok) return;
    setEdits({});
    setTagOps(new Map());
    setError(null);
    markClean();
  }

  function onApply() {
    setError(null);
    startTransition(async () => {
      const res = await applyCharacterEdits({
        characterId: character.id,
        expectedUpdatedAt: character.updatedAt,
        core: edits,
        tags: ops,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setEdits({});
      setTagOps(new Map());
      markClean();
      refresh();
    });
  }

  // What the sheet WOULD look like if Apply were pressed — every tab renders
  // this rather than the stored row, so a staged change is visible everywhere
  // at once.
  const staged = { ...character, ...edits };

  // The dirty guard covers both frames: the page's own back-navigation isn't
  // gated by it (browser beforeunload still is), but the modal's close does
  // route through it — see the `frame === "modal"` branch below.
  const closeModal = () => guardedClose(onClose);

  const body = (
    <>
      <StateStrip
        character={character}
        staged={staged}
        discord={discord}
        held={held}
        equipSlots={equipSlots}
        maxDrawbackTags={maxDrawbackTags}
        gambitModifier={gambitModifier}
        openTurn={openTurn}
        hasActed={Boolean(openTurnAction)}
        stagedForPush={stagedForPush}
      />

      <ActionBar
        character={character}
        canDelete={canDelete}
        hasActed={Boolean(openTurnAction)}
        openTurn={openTurn}
        locations={locations}
        factions={factions}
        transferRoster={transferRoster}
        tags={tags}
        held={held}
        feed={feed}
        cursed={cursed}
        pendingCount={pendingCount}
        startingTagPoints={startingTagPoints}
        onStageTags={stageTagOps}
        onStageField={setField}
        refresh={refresh}
        onDeleted={onDeleted}
      />

      <div className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            data-active={t === tab}
            className="tab-item"
            onClick={() => openTab(t)}
          >
            {t}
            {t === "Tags" && ops.length > 0 && <> ({ops.length})</>}
          </button>
        ))}
      </div>

      {tab === "Identity" && (
        <IdentityTab
          staged={staged}
          lastNameLocked={lastNameLocked}
          factions={factions}
          locations={locations}
          roles={roles}
          edits={edits}
          onField={setField}
        />
      )}

      {tab === "Tags" && (
        <TagEditor
          characterId={character.id}
          characterName={character.name}
          tags={tags}
          held={held}
          ops={tagOps}
          openTurn={openTurn}
          equipSlots={equipSlots}
          onStage={stageTagOps}
        />
      )}

      {tab === "Turn" && (
        <TurnTab
          character={character}
          openTurn={openTurn}
          action={openTurnAction}
          defaultEffort={defaultEffort}
        />
      )}

      {tab === "Goals" && (
        <GoalsTab
          character={character}
          desires={desires}
          desireSlots={desireSlots}
          desireSlotStates={desireSlotStates}
          desireCatalog={desireCatalog}
          desireFamilies={desireFamilies}
          desireCooldowns={desireCooldowns}
        />
      )}

      {tab === "Record" && (
        <RecordTab
          record={record}
          error={recordError}
          discordUserId={character.discordUserId}
        />
      )}

      {/* The footer appears only when there is something to commit, so the
          panel reads as a viewer until the moment it isn't one. */}
      {(pendingCount > 0 || error) && (
        <div className="panel dev-apply-bar flex flex-wrap items-center justify-between gap-3 p-3">
          <span className="text-sm">
            {error ? (
              <span className="form-error" role="alert">{error}</span>
            ) : (
              <>
                <strong className="mono">{pendingCount}</strong> pending change
                {pendingCount === 1 ? "" : "s"}
              </>
            )}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={onApply} disabled={pending || !pendingCount}>
              {pending ? "Applying…" : "Apply"}
            </button>
          </span>
        </div>
      )}
    </>
  );

  const titleWithAvatar = (
    <span className="flex items-center gap-2">
      <CharacterAvatar characterId={character.id} name={character.name} version={character.updatedAt} size={32} />
      {staged.name || character.name}
    </span>
  );

  if (frame === "modal") {
    return (
      <Modal
        title={titleWithAvatar}
        onClose={closeModal}
        panelClassName="modal-panel dev-modal-panel"
      >
        {body}
      </Modal>
    );
  }

  return (
    <>
      <PageHeader
        title={titleWithAvatar}
        subtitle={
          <>
            All of the character&apos;s values can be edited.
          </>
        }
        actions={
          <Link href="/gm/players" className="btn-quiet">
            &larr; Players
          </Link>
        }
      />
      {body}
    </>
  );
}

// The read-only facts a GM wants before touching anything — the live state
// the panel is about to change, including the derived numbers that exist
// nowhere as a column (points spent, slots used, the gambit modifier).
function StateStrip({
  character,
  staged,
  discord,
  held,
  equipSlots,
  maxDrawbackTags,
  gambitModifier,
  openTurn,
  hasActed,
  stagedForPush,
}) {
  const equipped = held.filter((h) => h.equipped).length;
  // Point-bought drawbacks only, matching the cap PointBuy enforces — a
  // GM-inflicted wound is not one of the player's tags. Shown as a fact,
  // not a limit: a GM grant deliberately ignores every gate, this one
  // included. Counted as tags, not summed as points — see negativeTagCount.
  const drawbackCount = held.reduce((count, h) => {
    if (h.source !== "POINT_BUY") return count;
    return (h.pointCost ?? 0) < 0 ? count + 1 : count;
  }, 0);
  const overDrawbackCap = drawbackCount > maxDrawbackTags;
  // Four labeled clusters instead of one undifferentiated 15-fact grid, so a
  // GM's eye lands on the right group instead of scanning the whole strip.
  // Purely presentational — every value below is unchanged from before.
  const groups = [
    [
      "Identity",
      [
        ["Status", CHARACTER_STATUS[character.status]?.label ?? character.status],
        ["Role", staged.roleTitle ?? "—"],
        [
          "Faction",
          <FactionLink key="f" factionId={character.factionId} name={character.factionName ?? "—"} />,
        ],
        ["Location", character.locationName ?? "—"],
        ["Zone", character.zoneName ?? "—"],
      ],
    ],
    [
      "Economy",
      [
        ["Resources", `${staged.resources} ⬢`],
        ["Tag points", <TagPointsValue key="tp" points={staged.tagPoints} />],
        ["Equipment", `${equipped} / ${equipSlots}`],
        [
          "Drawbacks",
          <span key="db" className={overDrawbackCap ? "text-danger" : undefined}>
            {drawbackCount} / {maxDrawbackTags}
          </span>,
        ],
        ["Gambit", gambitModifier > 0 ? `+${gambitModifier}` : String(gambitModifier)],
      ],
    ],
    [
      "Turn",
      [
        ["Turn", openTurn ? `${openTurn.number} ${openTurn.phase}` : "none open"],
        ["Acted", hasActed ? "yes" : "no"],
      ],
    ],
    [
      "Discord",
      [
        ["Discord", discord.username ?? "not in guild"],
        ["Nickname", discord.nickname ?? "—"],
        ["Cursed", discord.cursed ? "yes" : "no"],
        ["Name role", character.discordRoleId ? "provisioned" : "missing"],
      ],
    ],
  ];

  return (
    <section className="panel p-3">
      <div className="dev-state-strip">
        {groups.map(([label, facts]) => (
          <dl key={label} className="dev-state-group">
            <span className="dev-state-group-label">{label}</span>
            {facts.map(([factLabel, value]) => (
              <div key={factLabel}>
                <dt className="field-label">{factLabel}</dt>
                <dd className="mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      {stagedForPush && (
        /* The adjudication workspace has queued changes against this sheet
           for the turn-end push. Live edits here are additive with those —
           nothing corrupts — but a GM who can't see the queue double-grants. */
        <p className="mt-2 text-xs text-accent">
          Staged for the push:{" "}
          {[
            stagedForPush.resources
              ? `${stagedForPush.resources > 0 ? "+" : ""}${stagedForPush.resources} ⬢`
              : null,
            stagedForPush.tagOps
              ? `${stagedForPush.tagOps} tag change${stagedForPush.tagOps === 1 ? "" : "s"}`
              : null,
            (stagedForPush.tagPoints ?? 0)
              ? `${stagedForPush.tagPoints > 0 ? "+" : ""}${stagedForPush.tagPoints} tag points`
              : null,
          ]
            .filter(Boolean)
            .join(", ")}{" "}
          — queued in /gm/turns, lands at turn end.
        </p>
      )}
    </section>
  );
}
