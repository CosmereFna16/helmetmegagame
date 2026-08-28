"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import DmThread from "@/app/components/DmThread";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import DevPanelModal from "@/app/components/DevPanelModal";
import ZoneChip from "@/app/components/ZoneChip";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import {
  getDmThreadPage,
  sendGmDm,
  markConversationRead,
  claimConversation,
  releaseConversation,
} from "../actions";

function draftKey(discordUserId) {
  return `messages-draft-${discordUserId}`;
}

// Per-conversation draft persistence, read through useSyncExternalStore —
// same discipline as the shared pins (usePins.js): the textarea's value IS
// the store's value (no parallel useState to seed via an effect, which is
// what react-hooks/set-state-in-effect exists to catch), and writing to it is
// a direct localStorage write + a manual `storage` dispatch (the event
// doesn't fire in the tab that wrote it).
function subscribeDraft(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function serverDraft() {
  return "";
}

// The centre column: a real chat pane rather than a thread block sitting in
// document flow. The transcript takes the height that's left and scrolls
// inside itself; the composer is pinned to the bottom where a composer
// belongs.
export default function ConversationPane({
  discordUserId,
  label,
  characterId,
  zoneName,
  statusLabel,
  moveId,
  initialMessages,
  initialHasMore,
  gmProfiles,
  myDiscordUserId,
  claimedByDiscordUserId,
  registerPrefill,
}) {
  // The parent page keys this component on `discordUserId`, so a conversation
  // switch remounts it — that's what resets this state, rather than an effect
  // syncing it to a prop.
  const [pages, setPages] = useState({ messages: initialMessages, hasMore: initialHasMore });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [claimedBy, setClaimedBy] = useState(claimedByDiscordUserId);
  const lastMarkedIdRef = useRef(null);
  // The Dev Panel open as a modal over this conversation, or null. Mirrors
  // RosterTable.js and the adjudication desk's Workspace.js — opening it
  // never navigates away from the conversation.
  const [devPanelOpen, setDevPanelOpen] = useState(false);

  const readDraft = useCallback(() => {
    try {
      return window.localStorage.getItem(draftKey(discordUserId)) ?? "";
    } catch {
      return "";
    }
  }, [discordUserId]);
  const content = useSyncExternalStore(subscribeDraft, readDraft, serverDraft);

  const writeDraft = useCallback(
    (value) => {
      try {
        if (value) window.localStorage.setItem(draftKey(discordUserId), value);
        else window.localStorage.removeItem(draftKey(discordUserId));
        window.dispatchEvent(new Event("storage"));
      } catch {
        /* private window / blocked site data */
      }
    },
    [discordUserId],
  );

  useEffect(() => {
    registerPrefill?.((text) => writeDraft(text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discordUserId]);

  // Mark-read: fires from a client effect after mount, and again whenever a
  // new INBOUND message id appears — NEVER during RSC render, which would
  // mark-on-hover under Next's link prefetch. Only while the tab is actually
  // visible, and de-duplicated per newest-message id via the ref.
  useEffect(() => {
    const newest = pages.messages[pages.messages.length - 1];
    if (!newest) return;
    if (lastMarkedIdRef.current === newest.id) return;
    if (document.visibilityState !== "visible") return;
    lastMarkedIdRef.current = newest.id;
    markConversationRead({ playerDiscordUserId: discordUserId });
  }, [pages.messages, discordUserId]);

  async function loadOlder() {
    const oldest = pages.messages[0];
    if (!oldest) return;
    const result = await getDmThreadPage({
      discordUserId,
      beforeMs: new Date(oldest.createdAt).getTime(),
      beforeId: oldest.id,
    });
    if (!result.ok) return;
    setPages((prev) => ({
      messages: [...result.messages, ...prev.messages],
      hasMore: result.hasMore,
    }));
  }

  function handleSend(e) {
    e.preventDefault();
    const message = content.trim();
    if (!message || message.length > GM_MESSAGE_MAX_LENGTH) return;
    setError(null);
    startTransition(async () => {
      const result = await sendGmDm({ discordUserId, content: message });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPages({ messages: result.messages, hasMore: result.hasMore });
      writeDraft("");
    });
  }

  function toggleClaim() {
    startTransition(async () => {
      if (claimedBy === myDiscordUserId) {
        await releaseConversation({ playerDiscordUserId: discordUserId });
        setClaimedBy(null);
      } else {
        await claimConversation({ playerDiscordUserId: discordUserId });
        setClaimedBy(myDiscordUserId);
      }
    });
  }

  const onKeyDown = useSubmitOnEnter();
  const over = content.length > GM_MESSAGE_MAX_LENGTH;
  const claimedByOther = claimedBy && claimedBy !== myDiscordUserId;

  return (
    <div className="desk-convo">
      <div className="desk-convo-head">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="section-title truncate">{label}</h2>
          {zoneName ? <ZoneChip zoneName={zoneName} /> : null}
          {statusLabel && <span className="chip text-xs text-muted">{statusLabel}</span>}
        </div>
        <div className="flex items-center gap-2">
          {moveId && (
            <Link href={`/gm/turns/move/${moveId}`} className="btn-quiet">
              Adjudicate →
            </Link>
          )}
          <DevCharacterButton
            characterId={characterId}
            name={label}
            onOpen={() => setDevPanelOpen(true)}
          />
          <button
            type="button"
            className="btn-quiet"
            disabled={claimedByOther || pending}
            onClick={toggleClaim}
          >
            {claimedBy
              ? claimedByOther
                ? "Claimed by another GM"
                : "Release claim"
              : "Claim conversation"}
          </button>
        </div>
      </div>

      <div className="desk-convo-thread">
        {pages.messages.length === 0 ? (
          <p className="text-sm text-muted p-4">
            No messages yet. Whatever you send first opens the conversation.
          </p>
        ) : (
          <DmThread
            messages={pages.messages}
            gmProfiles={gmProfiles}
            onLoadOlder={loadOlder}
            hasMore={pages.hasMore}
          />
        )}
      </div>

      <form className="desk-convo-composer" onSubmit={handleSend}>
        <label className="field">
          <span className="sr-only">Reply</span>
          <textarea
            rows={3}
            value={content}
            onChange={(e) => writeDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message ${label}…`}
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-xs"
            style={over ? { color: "var(--danger)" } : { color: "var(--muted)" }}
          >
            {content.length} / {GM_MESSAGE_MAX_LENGTH} · Enter sends, Shift+Enter for a new line
          </span>
          <button type="submit" className="btn" disabled={pending || !content.trim() || over}>
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </form>

      {devPanelOpen && (
        <DevPanelModal
          characterId={characterId}
          name={label}
          onClose={() => setDevPanelOpen(false)}
        />
      )}
    </div>
  );
}
