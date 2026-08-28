"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TagChip from "@/app/components/TagChip";
import FactionLink from "@/app/components/FactionLink";
import MarkdownContent from "@/app/components/MarkdownContent";
import { getCharacterInspector, getArchiveSlice } from "@/app/(desk)/gm/turns/actions";
import CanonPanel from "./CanonPanel";
import NotesTab from "./NotesTab";

// The right column: everything about this player that isn't the conversation.
// The adjudication desk's inspector is the same idea pointed the other way —
// there the character is context for a Move, here the Move is context for a
// character — so this deliberately mirrors its fetch discipline: on-demand
// server actions, memoized per `${characterId}:${tab}` for the life of the
// page view. A dossier is a reference surface; stale-by-minutes is fine, and
// switching tabs off and back is the refresh affordance.
//
// No DMs tab, unlike the inspector: the thread is the pane next door.

const TABS = ["Canon", "Sheet", "Tags", "Record", "Notes"];

function useDossierData(characterId, tab) {
  // Sheet and Tags read the same payload, so they share a cache key.
  // Canon arrives with the page and Notes fetches its own, so neither goes
  // through this cache.
  const fetched = tab !== "Canon" && tab !== "Notes";
  const key = characterId && fetched ? `${characterId}:${tab === "Tags" ? "Sheet" : tab}` : null;
  const [cache, setCache] = useState(() => new Map());
  const entry = key ? (cache.get(key) ?? null) : null;

  // setCache happens after the await, never synchronously in the effect body
  // (react-hooks/set-state-in-effect is an error in this repo).
  useEffect(() => {
    if (!key || !characterId || entry) return undefined;
    let cancelled = false;
    (async () => {
      const fetcher = tab === "Record" ? getArchiveSlice : getCharacterInspector;
      const res = await fetcher({ characterId });
      if (cancelled) return;
      const value = res?.ok ? { data: res } : { error: res?.error ?? "Couldn't load that." };
      setCache((prev) => (prev.has(key) ? prev : new Map(prev).set(key, value)));
    })();
    return () => {
      cancelled = true;
    };
  }, [key, characterId, tab, entry]);

  return {
    data: entry?.data ?? null,
    error: entry?.error ?? null,
    loading: Boolean(key) && !entry,
  };
}

function Fact({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="field-label">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export default function DossierColumn({
  characterId,
  canon,
  onPrefill,
  currentTurnNumber,
  gmProfiles,
  myDiscordUserId,
}) {
  const [tab, setTab] = useState("Canon");
  const { data, error, loading } = useDossierData(characterId, tab);
  const router = useRouter();

  // A different route under this same desk (/gm/players — the roster, with
  // its own Factions tab) rather than /faction, so a GM never leaves the
  // desk shell (the rail, the header) to look up a faction from here.
  function goToFaction(factionId) {
    router.push(`/gm/players?tab=factions&faction=${factionId}`);
  }

  if (!characterId) {
    return (
      <aside className="desk-dossier">
        <div className="desk-dossier-body">
          <p className="text-sm text-muted">
            No living character for this player, so there is no sheet to show. The conversation
            still works.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="desk-dossier">
      <div className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="tab-item"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="desk-dossier-body">
        {tab === "Canon" && (
          <CanonPanel canon={canon} onPrefill={onPrefill} />
        )}

        {tab === "Notes" && (
          <NotesTab
            characterId={characterId}
            gmProfiles={gmProfiles}
            myDiscordUserId={myDiscordUserId}
          />
        )}

        {loading && <p className="text-sm text-muted">Loading…</p>}
        {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}

        {tab === "Sheet" && data && (
          <div className="flex flex-col gap-2">
            <Fact label="Role">{data.roleTitle ?? "—"}</Fact>
            <Fact label="Faction">
              {data.factionId ? (
                <FactionLink
                  factionId={data.factionId}
                  name={data.factionName ?? "—"}
                  onSelect={goToFaction}
                />
              ) : (
                "—"
              )}
              {data.isLeader ? " · Leader" : ""}
            </Fact>
            <Fact label="Standing in">{data.locationLabel}</Fact>
            <Fact label="Status">{data.status}</Fact>
            <Fact label="Resources">
              <span className="mono">{data.resources} ⬢</span>
            </Fact>
            <Fact label="Tag points">
              <span className="mono">{data.tagPoints}</span>
            </Fact>
            <Fact label="Gambit modifier">
              <span className="mono">
                {data.gambitModifier > 0 ? `+${data.gambitModifier}` : data.gambitModifier}
              </span>
            </Fact>
            <Fact label="Acted this turn">{data.acted ? "yes" : "no"}</Fact>
          </div>
        )}

        {tab === "Tags" && data && (
          <div className="flex flex-wrap gap-1">
            {data.tags.length === 0 && <p className="text-sm text-muted">No tags held.</p>}
            {data.tags.map((ct) => (
              <TagChip
                key={ct.tagId}
                tag={ct.tag}
                quantity={ct.quantity}
                expiresTurn={ct.expiresTurn}
                equipped={ct.equipped}
                currentTurnNumber={currentTurnNumber}
              />
            ))}
          </div>
        )}

        {tab === "Record" && data && (
          <div className="flex flex-col gap-2">
            {data.entries.length === 0 && (
              <p className="text-sm text-muted">Nothing in the transcript yet.</p>
            )}
            {data.entries.map((e) => (
              <div key={e.id} className="text-sm">
                <p className="field-label mono">
                  T{e.turnNumber} {e.turnPhase} · {e.zoneName ?? "—"}
                </p>
                <MarkdownContent content={e.content} />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
