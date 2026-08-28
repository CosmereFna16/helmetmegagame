"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Modal from "@/app/components/Modal";
import DocumentMarkdown from "../../components/DocumentMarkdown";
import ChipText from "../../components/ChipText";
import { getDocumentHeadings } from "@/lib/documentHeadings";

// One card in the pinned board. Collapsed it shows its title, its source and
// a few lines of the text bleeding out under a fade; clicking opens the full
// sheet. The fade is a mask rather than a gradient overlay so it works on
// both themes without knowing the surface colour behind it.
function DocumentCard({ doc, onOpen }) {
  return (
    <button
      type="button"
      className={doc.pinned ? "doc-card doc-card--pinned" : "doc-card"}
      onClick={() => onOpen(doc)}
    >
      <span className="doc-card-source">
        {doc.pinned && <span aria-hidden="true">⌗ </span>}
        {doc.source}
      </span>
      <span className="doc-card-title">{doc.name}</span>
      {/* ChipText, not DocumentMarkdown: the card is a <button>, so a
          {tag:…} here has to be a plain label rather than a focusable chip,
          and Markdown's own <a>/<table> aren't legal inside one either.
          doc.previewText (see lib/documentPreview.js) is already flattened
          to plain prose server-side. The open sheet below is free to use
          the real thing. */}
      <ChipText text={doc.previewText} className="doc-card-body" />
    </button>
  );
}

// The sheet's own generated table of contents — only worth the space once a
// document actually has structure. Below that threshold (a one-paragraph
// stub, most role charters) it would be a single line pointing at itself.
const TOC_MIN_HEADINGS = 3;

// Keyed by the caller on doc.key, so stepping to another document (prev/next,
// a chip, a fresh card) is a full remount rather than a prop swap — that is
// what resets scroll position, the focus target and this component's own
// "Copied" flag for free, with no effect needed to sync any of them to the
// doc prop.
function DocumentSheet({ doc, onClose, onPrev, onNext }) {
  const headings = useMemo(() => getDocumentHeadings(doc.description), [doc.description]);
  const showToc = headings.length >= TOC_MIN_HEADINGS;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const url = `${window.location.origin}/documents?doc=${encodeURIComponent(doc.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (permissions, insecure context); the
      // button just silently fails to flip to "Copied" rather than throwing.
    }
  };

  return (
    <Modal panelClassName="doc-sheet" onClose={onClose}>
      <div className="doc-sheet-head">
        <div>
          <p className="doc-card-source">{doc.source}</p>
          <h2 className="section-title">{doc.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-quiet" onClick={copyLink}>
            {copied ? "Copied" : "⧉ Copy link"}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className={showToc ? "doc-sheet-layout" : undefined}>
        {showToc && (
          <nav className="doc-sheet-toc" aria-label="Sections">
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                data-depth={h.depth}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ block: "start" });
                }}
              >
                {h.text}
              </a>
            ))}
          </nav>
        )}
        <div className="doc-sheet-body">
          <DocumentMarkdown text={doc.description} />
        </div>
      </div>
      {(onPrev || onNext) && (
        <div className="doc-sheet-foot">
          <button type="button" className="btn-quiet" onClick={onPrev} disabled={!onPrev}>
            ← Previous
          </button>
          <button type="button" className="btn-quiet" onClick={onNext} disabled={!onNext}>
            Next →
          </button>
        </div>
      )}
    </Modal>
  );
}

const TABS = ["assigned", "public", "gamemaster", "secret", "all"];

// Search + sort operate on whichever list is on screen. Pinned cards are
// exempt from the query (a blank search should never hide the Handbook or
// Your Role) and always sort first regardless of mode.
function applyFilters(list, query, sortMode) {
  const q = query.trim().toLowerCase();
  const matches = (d) =>
    !q ||
    d.pinned ||
    d.name.toLowerCase().includes(q) ||
    d.source.toLowerCase().includes(q) ||
    (d.description ?? "").toLowerCase().includes(q);

  const filtered = list.filter(matches);
  const pinned = filtered.filter((d) => d.pinned);
  const rest = filtered.filter((d) => !d.pinned);

  if (sortMode === "az") {
    rest.sort((a, b) => a.name.localeCompare(b.name));
  }
  // "default" keeps the server's own order (role/handbook already lead their
  // list); "source" is grouped separately in renderBoard rather than sorted
  // into one flat array.
  return { pinned, rest };
}

function groupBySource(list) {
  const groups = new Map();
  for (const d of list) {
    if (!groups.has(d.source)) groups.set(d.source, []);
    groups.get(d.source).push(d);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function DocumentsBoard({
  publicDocs,
  assignedDocs,
  gmDocs = [],
  secretDocs = [],
  allDocs = [],
  hasCharacter,
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("default");

  const listsByTab = {
    assigned: assignedDocs,
    public: publicDocs,
    gamemaster: gmDocs,
    secret: secretDocs,
    all: allDocs,
  };

  // ?doc=<key> opens that sheet — the sheet's content is derived fresh from
  // the URL on every render, not seeded once into useState. That's the whole
  // fix for a document chip changing the URL but not the sheet: a chip is a
  // <Link>, so clicking one while a sheet is already open never remounts
  // this component, and the old code only ever read the param at mount.
  // Resolved against the lists the server already sent, so an unreadable key
  // simply opens nothing rather than revealing that it exists.
  const requested = params.get("doc");
  const found = requested
    ? TABS.map((name) => [name, listsByTab[name].find((d) => d.key === requested)]).find(
        ([, d]) => d,
      ) ?? null
    : null;
  const open = found ? found[1] : null;

  // Which tab the BOARD shows underneath is its own, freely-clickable piece
  // of state — only its initial value comes from the deep link, exactly like
  // before. Switching tabs while a sheet is open (from a chip that pointed
  // elsewhere) is left alone; the sheet keeps showing what the URL asked for.
  const [tab, setTab] = useState(found ? found[0] : hasCharacter ? "assigned" : "public");

  // Step through the tab the OPEN document lives in, not necessarily the
  // board's own selected tab (a chip can open a document from another tab
  // without switching the board underneath it).
  const navTab = found ? found[0] : tab;
  const { pinned: navPinned, rest: navRest } = applyFilters(listsByTab[navTab], query, sortMode);
  const navFlat = [...navPinned, ...navRest];
  const navIndex = open ? navFlat.findIndex((d) => d.key === open.key) : -1;
  const prevDoc = navIndex > 0 ? navFlat[navIndex - 1] : null;
  const nextDoc = navIndex >= 0 && navIndex < navFlat.length - 1 ? navFlat[navIndex + 1] : null;

  const openDoc = (doc) => router.push(`/documents?doc=${encodeURIComponent(doc.key)}`, { scroll: false });

  // Drop the param on close so a refresh lands on the board rather than
  // reopening what you just dismissed. replace, not push, so Back leaves
  // /documents instead of stepping through the sheet again.
  const close = () => {
    if (found) setTab(found[0]);
    if (requested) router.replace("/documents", { scroll: false });
  };

  // ←/→ and j/k step through the same list the Prev/Next footer uses, while a
  // sheet is open. Ignored with focus in a text field so it doesn't fight
  // typing in the search box. Modal.js already owns Escape/Tab; this only
  // adds keys Modal doesn't touch.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "ArrowLeft" || e.key === "k") && prevDoc) openDoc(prevDoc);
      else if ((e.key === "ArrowRight" || e.key === "j") && nextDoc) openDoc(nextDoc);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.key, prevDoc?.key, nextDoc?.key]);

  const switchTab = (name) => {
    setTab(name);
    setQuery("");
  };

  const activeList = listsByTab[tab];
  const { pinned, rest } = applyFilters(activeList, query, sortMode);
  const totalCount = activeList.length;
  const visibleCount = pinned.length + rest.length;

  const renderGrid = (docs) => (
    <div className="doc-board">
      {docs.map((d) => (
        <DocumentCard key={d.key} doc={d} onOpen={openDoc} />
      ))}
    </div>
  );

  const renderBoard = () => {
    if (sortMode === "source") {
      const groups = groupBySource(rest);
      return (
        <div className="flex flex-col gap-4">
          {pinned.length > 0 && renderGrid(pinned)}
          {groups.map(([source, docs]) => (
            <div key={source}>
              <p className="section-title">{source}</p>
              {renderGrid(docs)}
            </div>
          ))}
        </div>
      );
    }
    return renderGrid([...pinned, ...rest]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="tab-bar">
        {hasCharacter && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "assigned"}
            onClick={() => switchTab("assigned")}
          >
            Assigned ({assignedDocs.length})
          </button>
        )}
        <button
          type="button"
          className="tab-item"
          data-active={tab === "public"}
          onClick={() => switchTab("public")}
        >
          Public ({publicDocs.length})
        </button>
        {gmDocs.length > 0 && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "gamemaster"}
            onClick={() => switchTab("gamemaster")}
          >
            Gamemaster ({gmDocs.length})
          </button>
        )}
        {secretDocs.length > 0 && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "secret"}
            onClick={() => switchTab("secret")}
          >
            Secret ({secretDocs.length})
          </button>
        )}
        {allDocs.length > 0 && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "all"}
            onClick={() => switchTab("all")}
          >
            All ({allDocs.length})
          </button>
        )}
      </div>

      {totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="field" style={{ flex: "1 1 16rem" }}>
            <span className="field-label">Search</span>
            <input
              type="search"
              placeholder="Name, source, or text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {query && (
            <span className="text-sm text-muted">
              {visibleCount} of {totalCount}
            </span>
          )}
          <div className="segmented" role="group" aria-label="Sort">
            {[
              ["default", "Default"],
              ["az", "A–Z"],
              ["source", "Source"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={sortMode === mode}
                onClick={() => setSortMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {totalCount === 0 ? (
        <p className="panel p-4 empty-state">
          {tab === "assigned"
            ? "Nothing has been handed to you yet. Your role, your tags and your faction each bring their own papers."
            : tab === "gamemaster"
              ? "No gamemaster papers have been written yet."
              : tab === "secret"
                ? "No secret documents have been written yet."
                : tab === "all"
                  ? "No documents have been written yet."
                  : "No public documents have been posted yet."}
        </p>
      ) : visibleCount === 0 ? (
        <p className="panel p-4 empty-state">Nothing matches “{query}” in this tab.</p>
      ) : (
        renderBoard()
      )}

      {open && (
        <DocumentSheet
          key={open.key}
          doc={open}
          onClose={close}
          onPrev={prevDoc ? () => openDoc(prevDoc) : null}
          onNext={nextDoc ? () => openDoc(nextDoc) : null}
        />
      )}
    </div>
  );
}
