"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";
import GmAvatar from "./GmAvatar";
import CharacterAvatar from "./CharacterAvatar";
import useNowTick from "./useNowTick";
import { AUTOMATED_EFFECT_SOURCES } from "@/lib/dmSources";
import { dayKey, dayLabel, clockLabel, formatDmTime, fullTimestamp } from "@/lib/dmTime";

// The one shared thread — the player desk's conversation pane and the
// inspector's DMs tab both render this. It reads like a chat client rather
// than a support inbox: flat rows, one header (avatar, name, time) per run of
// messages from the same person, day dividers, a NEW line where the unread
// ones start, and a scroll that follows the conversation only when you're
// already at the bottom.
//
// Props:
//   messages        — DirectMessage DTOs (id, direction, content, createdAt,
//                     authorDiscordUserId, source, meta). createdAt may be a
//                     Date (server-rendered) or an ISO string (live feed).
//   gmProfiles      — web/lib/gmProfiles.js#getGmProfiles() result
//   onLoadOlder     — fetch the previous page; omit to hide the affordance
//   hasMore         — whether an older page exists
//   compact         — tighter padding for the inspector's narrow column
//   character       — { id, name, avatarVersion } of the conversation's own
//                     character, for the inbound rows' avatar and name
//   newSinceMs      — this GM's read cursor when the thread opened; the NEW
//                     line goes above the first inbound row after it
//   myDiscordUserId — the viewing GM, so their own send always scrolls

// Quiet source labels for the GM-authored rows that still need a "what kind
// of GM message is this" hint next to the name.
const SOURCE_LABELS = {
  staged_push: "turn result",
  gm_broadcast: "broadcast",
};

const RUN_GAP_MS = 7 * 60_000;
const AT_BOTTOM_PX = 80;

function messageMs(m) {
  return new Date(m.createdAt).getTime();
}

function isEmbed(m) {
  return m.meta?.embed === true;
}

// Bot/effect notifications — resource grants, dev-panel summaries, Move
// unlocks. They render as centred system lines, and runs of three or more
// collapse. Pure UI plumbing (source: "system_notice", the historical
// "prompt_reply") never reaches this component at all:
// @/lib/dmThread#withoutDmNoise excludes it at the query.
function isEffect(m) {
  return !isEmbed(m) && m.direction === "OUTBOUND" && AUTOMATED_EFFECT_SOURCES.includes(m.source);
}

function speakerKey(m) {
  if (m.direction === "INBOUND") return "in";
  return `out:${m.authorDiscordUserId ?? "bot"}`;
}

// Usually the thread owns its own scroll (.dm-thread's overflow-y: auto). In
// the player desk the pane owns it instead (.desk-convo-thread .dm-thread
// sets overflow-y: visible), so walk up to whichever element scrolls.
function getScrollEl(el) {
  let node = el;
  while (node) {
    if (/(auto|scroll)/.test(window.getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return el;
}

// Turns the flat message list into what's drawn: day dividers, the NEW line,
// collapsed effect runs, and rows tagged with whether they start a run.
function buildItems(messages, newSinceMs, now) {
  const items = [];
  let lastDay = null;
  let lastSpeaker = null;
  let lastMs = null;
  let newDrawn = false;
  let effectRun = [];

  const flushEffects = () => {
    if (effectRun.length === 0) return;
    if (effectRun.length >= 3) items.push({ type: "collapsed", key: `c:${effectRun[0].id}`, messages: effectRun });
    else for (const m of effectRun) items.push({ type: "system", key: m.id, message: m });
    effectRun = [];
    lastSpeaker = null;
  };

  for (const m of messages) {
    const ms = messageMs(m);
    const day = dayKey(ms);
    if (day !== lastDay) {
      flushEffects();
      items.push({ type: "day", key: `d:${day}`, label: dayLabel(ms, now) });
      lastDay = day;
      lastSpeaker = null;
    }
    if (!newDrawn && newSinceMs != null && m.direction === "INBOUND" && ms > newSinceMs) {
      flushEffects();
      items.push({ type: "new", key: "new" });
      newDrawn = true;
      lastSpeaker = null;
    }
    if (isEffect(m)) {
      effectRun.push(m);
      continue;
    }
    flushEffects();
    const speaker = speakerKey(m);
    const head = speaker !== lastSpeaker || lastMs == null || ms - lastMs > RUN_GAP_MS || isEmbed(m);
    items.push({ type: "message", key: m.id, message: m, head, ms });
    lastSpeaker = isEmbed(m) ? null : speaker;
    lastMs = ms;
  }
  flushEffects();
  return items;
}

// Splits a flattened embed's `content` into a title, an optional plain
// description, and any `**Field**: value` rows. See bot/src/lib/dm.js for
// how the embed got flattened into content in the first place.
const FIELD_LINE = /^\*\*(.+?)\*\*:\s*(.*)$/;

function parseEmbedContent(content) {
  const lines = (content ?? "").split("\n");
  let title = null;
  const descriptionLines = [];
  const fields = [];
  for (const line of lines) {
    if (title === null) {
      if (line.trim() === "") continue;
      title = line;
      continue;
    }
    const match = line.match(FIELD_LINE);
    if (match) fields.push({ name: match[1], value: match[2] });
    else descriptionLines.push(line);
  }
  return { title: title ?? "", description: descriptionLines.join("\n").trim(), fields };
}

function EmbedBody({ message }) {
  const [expanded, setExpanded] = useState(false);
  const { title, description, fields } = useMemo(() => parseEmbedContent(message.content), [message.content]);
  const bodyLineCount = (description ? description.split("\n").length : 0) + fields.length;

  if (bodyLineCount === 0) {
    return (
      <div className="dm-embed">
        {title ? <span>{title}</span> : <MarkdownContent content={message.content} />}
      </div>
    );
  }
  return (
    <div className="dm-embed">
      <button type="button" className="dm-embed-toggle" onClick={() => setExpanded((v) => !v)}>
        <span>{title}</span>
        {!expanded && <span className="dm-embed-more">· {bodyLineCount} more</span>}
      </button>
      {expanded && (
        <div className="mt-1">
          {description && <MarkdownContent content={description} />}
          {fields.length > 0 && (
            <dl className="tag-meta">
              {fields.map((f, i) => (
                <div key={i} className="contents">
                  <dt>{f.name}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

// A bot/effect notification — background texture, not a conversational turn.
// No avatar, no name, no row shape, the way nobody reads Discord's own "X
// pinned a message" lines.
function SystemLine({ message }) {
  return (
    <div className="dm-system-line-row">
      <div className="dm-system-line">
        <MarkdownContent content={message.content} />
        <time className="dm-system-line-time">{fullTimestamp(messageMs(message))}</time>
      </div>
    </div>
  );
}

function CollapsedGroup({ messages }) {
  const [expanded, setExpanded] = useState(false);
  if (expanded) return messages.map((m) => <SystemLine key={m.id} message={m} />);
  return (
    <div className="dm-system-line-row">
      <button type="button" className="btn-quiet" onClick={() => setExpanded(true)}>
        {messages.length} automated messages
      </button>
    </div>
  );
}

function Row({ item, gmProfileById, character, now }) {
  const { message, head, ms } = item;
  const outbound = message.direction === "OUTBOUND";
  const profile = outbound && message.authorDiscordUserId ? gmProfileById.get(message.authorDiscordUserId) ?? null : null;
  const name = outbound ? (message.authorDiscordUserId ? profile?.username ?? "GM" : "Bascinet") : character?.name ?? "Player";
  const sourceLabel = outbound ? SOURCE_LABELS[message.source] : null;
  const embed = isEmbed(message);

  return (
    <div
      className={head ? "dm-row dm-row-head" : "dm-row dm-row-cont"}
      data-pending={message.pending || undefined}
      data-dir={outbound ? "out" : "in"}
    >
      <div className="dm-row-gutter" aria-hidden={head ? undefined : "true"}>
        {head ? (
          outbound ? (
            <GmAvatar profile={profile} size={32} />
          ) : (
            <CharacterAvatar characterId={character?.id ?? null} name={name} version={character?.avatarVersion} size={32} />
          )
        ) : (
          <span className="dm-row-cont-time mono">{clockLabel(ms)}</span>
        )}
      </div>
      <div className="dm-row-body">
        {head && (
          <div className="dm-row-meta">
            <span className="dm-row-name">{name}</span>
            {sourceLabel && <span className="chip text-xs text-muted">{sourceLabel}</span>}
            <time className="dm-row-time mono" title={fullTimestamp(ms)}>
              {formatDmTime(ms, now)}
            </time>
          </div>
        )}
        {embed ? <EmbedBody message={message} /> : <MarkdownContent content={message.content} />}
      </div>
    </div>
  );
}

export default function DmThread({
  messages,
  gmProfiles = [],
  onLoadOlder,
  hasMore,
  compact = false,
  character = null,
  newSinceMs = null,
  myDiscordUserId = null,
}) {
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);
  const prevFirstIdRef = useRef(null);
  const prevLastIdRef = useRef(null);
  const anchorHeightRef = useRef(null);
  const loadingOlderRef = useRef(false);
  // Where the NEW line goes is decided once, when the thread opens: mark-read
  // fires a moment later, and the line must not move because of it. State
  // seeded from the prop, never re-synced.
  const [newSince] = useState(newSinceMs);

  // Whether the reader is at (or near) the bottom, kept as state because the
  // "N new messages ↓" pill renders off it. It only ever changes from the
  // scroll listener — an event callback, not an effect body.
  const [atBottom, setAtBottom] = useState(true);
  const [seenBottomId, setSeenBottomId] = useState(null);

  const now = useNowTick(60_000);
  const gmProfileById = useMemo(() => new Map(gmProfiles.map((p) => [p.discordUserId, p])), [gmProfiles]);
  const items = useMemo(() => buildItems(messages, newSince, now), [messages, newSince, now]);

  const firstId = messages[0]?.id ?? null;
  const lastId = messages[messages.length - 1]?.id ?? null;
  // The scroll listener below needs the newest id without re-subscribing on
  // every message, so it reads a ref that an effect keeps current.
  const lastIdRef = useRef(lastId);
  useEffect(() => {
    lastIdRef.current = lastId;
  }, [lastId]);

  // Follow the conversation only when already following it. A GM's own send
  // always goes to the bottom — pressing Enter in a composer pinned there
  // means that's where they were. A player's message landing while the GM
  // is reading history must not yank them.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollEl = getScrollEl(el);

    const wasPrepend =
      prevFirstIdRef.current && firstId && firstId !== prevFirstIdRef.current && lastId === prevLastIdRef.current;
    const wasAppend = lastId && lastId !== prevLastIdRef.current;
    const newest = messages[messages.length - 1];
    const mine =
      newest && (newest.pending || (newest.direction === "OUTBOUND" && newest.authorDiscordUserId === myDiscordUserId));

    if (wasPrepend && anchorHeightRef.current != null) {
      scrollEl.scrollTop = scrollEl.scrollHeight - anchorHeightRef.current;
      loadingOlderRef.current = false;
    } else if (prevLastIdRef.current == null || (wasAppend && (atBottom || mine))) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // The scroll listener: tracks "at the bottom" and remembers the newest row
  // seen from there, which is what the pill counts against.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const scrollEl = getScrollEl(el);
    function onScroll() {
      const near = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < AT_BOTTOM_PX;
      setAtBottom(near);
      setSeenBottomId((prev) => (near || prev == null ? lastIdRef.current : prev));
    }
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, []);

  const requestOlder = useCallback(() => {
    if (!hasMore || !onLoadOlder || loadingOlderRef.current) return;
    const el = containerRef.current;
    anchorHeightRef.current = el ? getScrollEl(el).scrollHeight : null;
    loadingOlderRef.current = true;
    onLoadOlder();
  }, [hasMore, onLoadOlder]);

  // Older pages load on their own as the reader nears the top, the way a chat
  // client does it, instead of on a button.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || !onLoadOlder) return undefined;
    const el = containerRef.current;
    const root = el ? getScrollEl(el) : null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) requestOlder();
      },
      { root: root === document.scrollingElement ? null : root, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadOlder, requestOlder]);

  function jumpToBottom() {
    const el = containerRef.current;
    if (!el) return;
    const scrollEl = getScrollEl(el);
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
  }

  // How many rows landed below the reader since they last sat at the bottom.
  const newBelow = useMemo(() => {
    if (atBottom || seenBottomId == null) return 0;
    const idx = messages.findIndex((m) => m.id === seenBottomId);
    return idx < 0 ? 0 : messages.length - 1 - idx;
  }, [atBottom, seenBottomId, messages]);

  return (
    <div ref={containerRef} className={`dm-thread ${compact ? "dm-thread-compact" : ""}`}>
      {hasMore && onLoadOlder && (
        <div ref={sentinelRef} className="dm-older">
          <button type="button" className="btn-quiet" onClick={requestOlder}>
            Load older messages
          </button>
        </div>
      )}
      {items.map((item) => {
        switch (item.type) {
          case "day":
            return (
              <div key={item.key} className="dm-day" role="separator">
                <span>{item.label}</span>
              </div>
            );
          case "new":
            return (
              <div key={item.key} className="dm-new" role="separator">
                <span>NEW</span>
              </div>
            );
          case "system":
            return <SystemLine key={item.key} message={item.message} />;
          case "collapsed":
            return <CollapsedGroup key={item.key} messages={item.messages} />;
          default:
            return <Row key={item.key} item={item} gmProfileById={gmProfileById} character={character} now={now} />;
        }
      })}
      {messages.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
      {newBelow > 0 && (
        <div className="dm-jump-row">
          <button type="button" className="dm-jump" onClick={jumpToBottom}>
            ↓ {newBelow} new {newBelow === 1 ? "message" : "messages"}
          </button>
        </div>
      )}
    </div>
  );
}
