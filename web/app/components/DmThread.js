"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";
import GmAvatar from "./GmAvatar";

// Quiet source labels for machine-authored rows — a GM should be able to
// tell a turn result from an automated nudge at a glance, without it
// competing with the actual message text.
const SOURCE_LABELS = {
  staged_push: "turn result",
  bot_auto: "automated",
  gm_broadcast: "broadcast",
  move_unlock: "unlock",
};

function authorLabel(message, gmProfileById) {
  if (message.direction === "INBOUND") return null;
  if (message.authorDiscordUserId) {
    const profile = gmProfileById.get(message.authorDiscordUserId);
    return { name: profile?.username ?? "GM", profile: profile ?? null };
  }
  return { name: "Bascinet", profile: null };
}

// Runs of ≥3 consecutive bot_auto rows collapse into one expandable "N
// automated messages" row. staged_push never collapses — it's canon, a turn
// result a GM needs to actually see.
function groupMessages(messages) {
  const groups = [];
  let run = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length >= 3) groups.push({ type: "collapsed", messages: run });
    else for (const m of run) groups.push({ type: "single", message: m });
    run = [];
  };
  for (const m of messages) {
    if (m.source === "bot_auto") {
      run.push(m);
    } else {
      flushRun();
      groups.push({ type: "single", message: m });
    }
  }
  flushRun();
  return groups;
}

function Bubble({ message, gmProfileById }) {
  const outbound = message.direction === "OUTBOUND";
  const author = authorLabel(message, gmProfileById);
  const sourceLabel = outbound ? SOURCE_LABELS[message.source] : null;

  return (
    <div className="flex flex-col" style={{ alignItems: outbound ? "flex-end" : "flex-start" }}>
      <div className={outbound ? "dm-bubble dm-bubble-out" : "dm-bubble dm-bubble-in"}>
        <MarkdownContent content={message.content} />
      </div>
      <span className="mt-1 flex items-center gap-1 text-xs text-muted">
        {author?.profile && <GmAvatar profile={author.profile} size={14} />}
        {author?.name && <span>{author.name}</span>}
        {sourceLabel && <span aria-hidden="true">· {sourceLabel}</span>}
        <span>{new Date(message.createdAt).toLocaleString()}</span>
      </span>
    </div>
  );
}

function CollapsedGroup({ group, gmProfileById }) {
  const [expanded, setExpanded] = useState(false);
  if (expanded) {
    return (
      <>
        {group.messages.map((m) => (
          <Bubble key={m.id} message={m} gmProfileById={gmProfileById} />
        ))}
      </>
    );
  }
  return (
    <div className="flex justify-start">
      <button type="button" className="btn-quiet" onClick={() => setExpanded(true)}>
        {group.messages.length} automated messages
      </button>
    </div>
  );
}

// The one shared thread component — used by /gm/messages/[discordUserId] and,
// with `compact`, the adjudication Inspector's DMs tab (a later task wires
// that up; this component is already shaped for it).
//
// Props:
//   messages    — DirectMessage DTOs (id, direction, content, createdAt,
//                 authorDiscordUserId, source)
//   gmProfiles  — web/lib/gmProfiles.js#getGmProfiles() result
//   onLoadOlder — called with no args to fetch the previous page; omit to
//                 hide the control
//   hasMore     — whether an older page exists
//   compact     — tighter padding for the Inspector's narrower column
export default function DmThread({ messages, gmProfiles = [], onLoadOlder, hasMore, compact = false }) {
  const containerRef = useRef(null);
  const prevFirstIdRef = useRef(null);
  const prevLastIdRef = useRef(null);
  const anchorHeightRef = useRef(null);

  const gmProfileById = useMemo(() => new Map(gmProfiles.map((p) => [p.discordUserId, p])), [gmProfiles]);
  const groups = useMemo(() => groupMessages(messages), [messages]);

  // Measure before the DOM updates (prepend vs. append), adjust after.
  const firstId = messages[0]?.id ?? null;
  const lastId = messages[messages.length - 1]?.id ?? null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const wasPrepend = prevFirstIdRef.current && firstId && firstId !== prevFirstIdRef.current && lastId === prevLastIdRef.current;
    const wasAppend = lastId && lastId !== prevLastIdRef.current;

    if (wasPrepend && anchorHeightRef.current != null) {
      el.scrollTop = el.scrollHeight - anchorHeightRef.current;
    } else if (wasAppend || prevLastIdRef.current == null) {
      el.scrollTop = el.scrollHeight;
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  function handleLoadOlder() {
    const el = containerRef.current;
    anchorHeightRef.current = el ? el.scrollHeight : null;
    onLoadOlder?.();
  }

  return (
    <div ref={containerRef} className={`panel dm-thread flex flex-col gap-3 ${compact ? "p-3" : "p-4"}`}>
      {hasMore && (
        <button type="button" className="btn-quiet self-center" onClick={handleLoadOlder}>
          Load older messages
        </button>
      )}
      {groups.map((g, i) =>
        g.type === "collapsed" ? (
          <CollapsedGroup key={g.messages[0].id} group={g} gmProfileById={gmProfileById} />
        ) : (
          <Bubble key={g.message.id} message={g.message} gmProfileById={gmProfileById} />
        ),
      )}
      {messages.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
    </div>
  );
}
