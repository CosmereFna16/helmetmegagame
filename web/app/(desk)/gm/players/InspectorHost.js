"use client";

import { useCallback, useMemo, useState } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import InspectorColumn from "@/app/components/InspectorColumn";
import DevPanelModal from "@/app/components/DevPanelModal";
import usePins from "@/app/components/usePins";
import BulkComposer from "./BulkComposer";
import CanonTab from "./CanonTab";

// The player desk's half of the shared inspector (the other is
// /gm/turns/Workspace.js). It is mounted by layout.js, so it survives every
// navigation inside the desk — including to the roster, where the old
// DossierColumn simply did not exist.
//
// Which person it shows is DERIVED, not stored:
//
//   segment  — useSelectedLayoutSegment() is the [discordUserId] the child
//              route is on, so opening a conversation points the inspector at
//              that player without anybody having to tell it.
//   override — the last person clicked in the inspector's own search or pin
//              row, which is how a GM looks at somebody OTHER than the open
//              conversation.
//
// The override remembers which segment it was set under and is ignored once
// the route moves on, so navigating to another player follows the route again
// instead of staying stuck on a stale pin. All of that is computed during
// render — no effect syncing state to a prop, which is what
// react-hooks/set-state-in-effect (an error in this repo) exists to catch.

export default function InspectorHost({
  rows,
  stagedEffects,
  currentTurnNumber,
  bulkCharacters,
  tagCatalog,
}) {
  const segment = useSelectedLayoutSegment();
  const [override, setOverride] = useState(null); // { segment, value }
  const [cache, setCache] = useState(() => new Map());
  const [devPanel, setDevPanel] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const rowByUser = useMemo(() => new Map(rows.map((r) => [r.discordUserId, r])), [rows]);
  const rowByCharacter = useMemo(
    () => new Map(rows.filter((r) => r.characterId).map((r) => [r.characterId, r])),
    [rows],
  );

  const knownPinIdentities = useMemo(() => {
    const ids = new Set();
    for (const r of rows) {
      if (r.characterId) ids.add(`c:${r.characterId}`);
      if (r.discordUserId) ids.add(`u:${r.discordUserId}`);
    }
    return ids;
  }, [rows]);
  const { pins, togglePin } = usePins({ knownIdentities: knownPinIdentities });

  // The inspector can only show somebody who has a character sheet, so a
  // player-only ("u:") pin stays in the list for the rail and is skipped here.
  const pinned = useMemo(
    () =>
      pins
        .map((p) =>
          p.characterId ? rowByCharacter.get(p.characterId) : rowByUser.get(p.discordUserId),
        )
        .filter((r) => r?.characterId)
        .map((r) => ({ characterId: r.characterId, discordUserId: r.discordUserId, name: r.name })),
    [pins, rowByCharacter, rowByUser],
  );

  const fromSegment = segment ? (rowByUser.get(segment) ?? null) : null;
  const activeOverride = override && override.segment === segment ? override.value : null;
  const inspectedRow = activeOverride ?? fromSegment;
  const inspected = inspectedRow?.characterId
    ? {
        characterId: inspectedRow.characterId,
        discordUserId: inspectedRow.discordUserId,
        name: inspectedRow.name,
      }
    : null;

  // The third argument is an optional tab request — Canon's "Past moves →"
  // uses it to land on the inspector's Moves tab. Token-stamped so the column
  // can tell a fresh ask from the one it already honoured.
  const [tabRequest, setTabRequest] = useState(null); // { tab, token }
  const onInspect = useCallback(
    (characterId, name, tab) => {
      const row = rowByCharacter.get(characterId);
      if (row) setOverride({ segment, value: row });
      if (tab) setTabRequest((prev) => ({ tab, token: (prev?.token ?? 0) + 1 }));
    },
    [rowByCharacter, segment],
  );

  const roster = useMemo(
    () =>
      rows
        .filter((r) => r.characterId)
        .map((r) => ({
          id: r.characterId,
          name: r.name,
          roleTitle: r.roleTitle,
          factionName: r.factionName,
          zoneName: r.zoneName,
          username: r.username,
        })),
    [rows],
  );

  // Same shape Workspace builds, so StagedDeltaFact dims and suffixes
  // identically on both desks.
  const pendingByCharacter = useMemo(() => {
    const map = new Map();
    for (const e of stagedEffects) {
      const entry = map.get(e.targetCharacterId) ?? {
        resources: 0,
        tagPoints: 0,
        removes: new Set(),
        adds: new Set(),
      };
      entry.resources += e.resources ?? 0;
      entry.tagPoints += e.tagPoints ?? 0;
      for (const op of e.tagOps ?? []) (op.op === "remove" ? entry.removes : entry.adds).add(op.tagId);
      map.set(e.targetCharacterId, entry);
    }
    return map;
  }, [stagedEffects]);

  // Canon is the one tab the adjudication desk has no use for — there the
  // character is context for a Move; here the Move is context for a character.
  const extraTabs = useMemo(
    () => [
      {
        key: "Canon",
        label: "Canon",
        render: ({ inspected: who }) => (
          <CanonTab
            key={who.characterId}
            characterId={who.characterId}
            // Insert-into-reply writes the open conversation's draft, so it is
            // only offered when the inspected person IS the open conversation
            // — a pinned someone-else must not overwrite an unrelated draft.
            discordUserId={who.discordUserId === segment ? who.discordUserId : null}
            // Canon is this turn; the Moves tab is everything before it.
            // Rather than repeat the history here, Canon points at it.
            onPastMoves={() => onInspect(who.characterId, who.name, "Moves")}
          />
        ),
      },
    ],
    [segment, onInspect],
  );

  // The custom-tag door. It APPLIES here rather than staging: this desk is a
  // conversation, not a push — a GM inventing a tag mid-reply means the
  // player has it. (The toggle is still offered, hence allowStage.)
  const customTag = useMemo(
    () => ({
      mode: "apply",
      categories: [...new Set((tagCatalog ?? []).map((t) => t.category))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      tags: tagCatalog ?? [],
      groups: [
        ...new Map(
          (tagCatalog ?? [])
            .filter((t) => t.group?.id)
            .map((t) => [t.group.id, { id: t.group.id, name: t.group.name }]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    }),
    [tagCatalog],
  );

  const pinsActions =
    pinned.length > 0 ? (
      <button type="button" className="btn-quiet" onClick={() => setBulkOpen(true)}>
        Message pinned
      </button>
    ) : null;

  return (
    <>
      <InspectorColumn
        inspected={inspected}
        pinned={pinned}
        roster={roster}
        onInspect={onInspect}
        onTogglePin={togglePin}
        cache={cache}
        setCache={setCache}
        tagsById={{}}
        currentTurnNumber={currentTurnNumber}
        pendingByCharacter={pendingByCharacter}
        onOpenDev={(characterId, name) => setDevPanel({ characterId, name })}
        extraTabs={extraTabs}
        pinsActions={pinsActions}
        customTag={customTag}
        requestedTab={tabRequest}
        emptyHint="Pick somebody in the rail, or look them up above, to keep their sheet beside the conversation."
      />

      {bulkOpen && (
        <BulkComposer
          characters={bulkCharacters}
          initialSelectedIds={pinned.map((p) => p.characterId)}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {devPanel && (
        <DevPanelModal
          characterId={devPanel.characterId}
          name={devPanel.name}
          onClose={() => setDevPanel(null)}
        />
      )}
    </>
  );
}
