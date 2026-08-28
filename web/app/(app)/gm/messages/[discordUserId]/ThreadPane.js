"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import DmThread from "@/app/components/DmThread";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { getDmThreadPage, sendGmDm, markConversationRead, claimConversation, releaseConversation } from "../actions";

function draftKey(discordUserId) {
  return `messages-draft-${discordUserId}`;
}

// Per-conversation draft persistence, read through useSyncExternalStore —
// same discipline as the desk's pins (Workspace.js): the textarea's value IS
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

export default function ThreadPane({
  discordUserId,
  label,
  initialMessages,
  initialHasMore,
  gmProfiles,
  myDiscordUserId,
  claimedByDiscordUserId,
  // Extension points for a later task (CanonPanel prefill buttons, extra
  // header content like the current-Move summary) — not built here, just
  // kept open so DmThread/ThreadPane don't need reshaping later.
  extraHeaderContent = null,
  registerPrefill,
}) {
  // The parent page keys this component on `discordUserId` (see
  // [discordUserId]/page.js), so a conversation switch remounts it — that's
  // what resets this state, rather than an effect syncing it to a prop.
  const [pages, setPages] = useState({ messages: initialMessages, hasMore: initialHasMore });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [claimedBy, setClaimedBy] = useState(claimedByDiscordUserId);
  const lastMarkedIdRef = useRef(null);

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

  const over = content.length > GM_MESSAGE_MAX_LENGTH;
  const claimedByOther = claimedBy && claimedBy !== myDiscordUserId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">{label}</h2>
        <div className="flex items-center gap-2">
          {extraHeaderContent}
          <button
            type="button"
            className="btn-quiet"
            disabled={claimedByOther || pending}
            onClick={toggleClaim}
          >
            {claimedBy ? (claimedByOther ? "Claimed by another GM" : "Release claim") : "Claim conversation"}
          </button>
        </div>
      </div>

      <DmThread messages={pages.messages} gmProfiles={gmProfiles} onLoadOlder={loadOlder} hasMore={pages.hasMore} />

      <form className="panel flex flex-col gap-2 p-4" onSubmit={handleSend}>
        <label className="field">
          <span className="field-label">Reply</span>
          <textarea rows={3} value={content} onChange={(e) => writeDraft(e.target.value)} />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={over ? { color: "var(--danger)" } : { color: "var(--muted)" }}>
            {content.length} / {GM_MESSAGE_MAX_LENGTH}
          </span>
          <button type="submit" className="btn" disabled={pending || !content.trim() || over}>
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
        {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      </form>
    </div>
  );
}
