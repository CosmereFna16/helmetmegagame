"use client";

import { Children, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "./icons";

const MARGIN = 8;
const GAP = 4;
const TYPEAHEAD_RESET_MS = 500;

// The drop-in replacement for a bare <select>. Same children (<option> /
// <optgroup>), same value/onChange/defaultValue/name/required/disabled
// contract, so almost every call site migrates by renaming the tag. The
// reason it exists: a native <select>'s CLOSED control is fully themeable
// (that's what .field select / .control already did), but its OPEN popup is
// OS-drawn chrome that `color-scheme` only partly controls — on some
// browsers it renders light-on-light regardless of the page's theme. This
// renders the popup itself, so every pixel follows the theme.
//
// Controlled (value + onChange) and uncontrolled (name + defaultValue, read
// via FormData in a server action) both work, exactly like a real <select>:
// uncontrolled mode keeps its own state and mirrors it into a hidden input
// so the surrounding <form> still sees it. onChange is called with a
// {target: {value, name}} shape so `(e) => setX(e.target.value)` call sites
// need no change at all.
//
// Multi-select has no equivalent here on purpose — gm/dev/page.js's Bulk
// Move picker (`<select multiple size={8}>`) is an open, always-visible
// listbox, not a popup, so the OS-popup problem this solves doesn't apply to
// it, and it stays a native <select>.
function optionsFromChildren(children) {
  const items = [];
  let lastGroup = null;
  const push = (item) => {
    items.push({ ...item, showGroup: !!item.groupLabel && item.groupLabel !== lastGroup });
    lastGroup = item.groupLabel;
  };
  Children.forEach(children, (child) => {
    if (!child || !child.props) return;
    if (child.type === "optgroup") {
      const groupLabel = child.props.label;
      Children.forEach(child.props.children, (opt) => {
        if (!opt || !opt.props) return;
        push({
          value: opt.props.value ?? opt.props.children,
          label: opt.props.children,
          disabled: !!opt.props.disabled,
          groupLabel,
        });
      });
    } else {
      push({
        value: child.props.value ?? child.props.children,
        label: child.props.children,
        disabled: !!child.props.disabled,
        groupLabel: null,
      });
    }
  });
  return items;
}

export default function Select({
  children,
  value,
  onChange,
  defaultValue,
  name,
  id,
  required,
  disabled,
  className = "",
  style,
  "aria-label": ariaLabel,
}) {
  const items = useMemo(() => optionsFromChildren(children), [children]);
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? value : internalValue;

  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState(null);
  const typeahead = useRef({ text: "", timer: null });

  const triggerRef = useRef(null);
  const popupRef = useRef(null);

  const selectedIndex = items.findIndex((it) => it.value === currentValue);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  const enabledIndexes = useMemo(
    () => items.reduce((acc, it, i) => (it.disabled ? acc : [...acc, i]), []),
    [items],
  );

  const commit = useCallback(
    (item) => {
      if (!item || item.disabled) return;
      if (!isControlled) setInternalValue(item.value);
      onChange?.({ target: { value: item.value, name } });
    },
    [isControlled, onChange, name],
  );

  const selectAndClose = useCallback(
    (item) => {
      commit(item);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [commit],
  );

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const el = popupRef.current;
    if (!trigger || !el) return;
    const t = trigger.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    const vw = document.documentElement.clientWidth;
    const roomBelow = vh - t.bottom - MARGIN;
    const roomAbove = t.top - MARGIN;
    const below = roomBelow >= 160 || roomBelow >= roomAbove;
    const left = Math.min(Math.max(MARGIN, t.left), Math.max(MARGIN, vw - t.width - MARGIN));
    setPos({
      left,
      width: t.width,
      top: below ? t.bottom + GAP : undefined,
      bottom: below ? undefined : vh - t.top + GAP,
      maxHeight: Math.max(120, (below ? roomBelow : roomAbove) - GAP),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    popupRef.current
      ?.querySelector(`#${CSS.escape(`${listId}-${highlight}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, listId]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    const onPointerDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popupRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, place]);

  const openAt = useCallback(
    (index) => {
      const start = index >= 0 ? index : (enabledIndexes[0] ?? 0);
      setHighlight(start);
      setOpen(true);
    },
    [enabledIndexes],
  );

  const moveHighlight = useCallback(
    (delta) => {
      setHighlight((h) => {
        const pool = enabledIndexes;
        if (pool.length === 0) return h;
        const at = pool.indexOf(h);
        const from = at === -1 ? (delta > 0 ? -1 : pool.length) : at;
        const next = Math.min(Math.max(from + delta, 0), pool.length - 1);
        return pool[next];
      });
    },
    [enabledIndexes],
  );

  const stepValue = useCallback(
    (delta) => {
      const pool = enabledIndexes;
      if (pool.length === 0) return;
      const at = pool.indexOf(selectedIndex);
      const from = at === -1 ? (delta > 0 ? -1 : pool.length) : at;
      const next = Math.min(Math.max(from + delta, 0), pool.length - 1);
      commit(items[pool[next]]);
    },
    [enabledIndexes, selectedIndex, items, commit],
  );

  const matchTypeahead = useCallback(
    (char) => {
      const buf = typeahead.current;
      clearTimeout(buf.timer);
      buf.text += char.toLowerCase();
      buf.timer = setTimeout(() => {
        buf.text = "";
      }, TYPEAHEAD_RESET_MS);
      const match = items.findIndex(
        (it) => !it.disabled && String(it.label).toLowerCase().startsWith(buf.text),
      );
      return match;
    },
    [items],
  );

  function handleTriggerKeyDown(e) {
    if (disabled) return;
    // A modifier combo (⌘K, ⌘C, browser back on ⌘←…) is never this control's
    // to own — let it bubble untouched. Everything else, while the trigger
    // has focus, IS this control's: without stopPropagation the desk's own
    // window-level shortcuts (QueueRail's j/k/arrows/m/r/c/h, Workspace's
    // Escape) saw the same keystroke, since this trigger is a <button>, not
    // one of the tag names those listeners allowlisted. Typing "m" in a
    // filter dropdown used to flip the whole rail to the Moves lens.
    if (e.metaKey || e.ctrlKey) return;
    e.stopPropagation();
    if (!open) {
      if (e.key === "ArrowDown" && e.altKey) {
        e.preventDefault();
        openAt(selectedIndex);
        return;
      }
      if (e.key === "Enter" || e.key === " " || e.key === "F4") {
        e.preventDefault();
        openAt(selectedIndex);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        stepValue(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        stepValue(-1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        if (enabledIndexes.length) commit(items[enabledIndexes[0]]);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (enabledIndexes.length) commit(items[enabledIndexes[enabledIndexes.length - 1]]);
        return;
      }
      if (e.key.length === 1 && e.key !== " ") {
        const match = matchTypeahead(e.key);
        if (match >= 0) commit(items[match]);
      }
      return;
    }

    // Open: navigation moves the highlight only; the value commits on
    // Enter/Space/click, same as the ARIA "select-only combobox" pattern.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      if (enabledIndexes.length) setHighlight(enabledIndexes[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      if (enabledIndexes.length) setHighlight(enabledIndexes[enabledIndexes.length - 1]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectAndClose(items[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1 && e.key !== " ") {
      const match = matchTypeahead(e.key);
      if (match >= 0) setHighlight(match);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        className={`control select-trigger ${className}`.trim()}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        aria-required={required || undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`select-value ${selected ? "" : "select-placeholder"}`.trim()}>
          {selected ? selected.label : ""}
        </span>
        <ChevronDownIcon className="select-chevron" aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={currentValue ?? ""} required={required} />}
      {open &&
        createPortal(
          <ul
            ref={popupRef}
            id={listId}
            role="listbox"
            className="select-popup"
            style={
              pos
                ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {items.map((item, i) => {
              return (
                <li key={`${item.groupLabel ?? ""}:${item.value}:${i}`}>
                  {item.showGroup && <div className="select-group-label">{item.groupLabel}</div>}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={item.value === currentValue}
                    aria-disabled={item.disabled || undefined}
                    data-highlighted={i === highlight || undefined}
                    className="select-option"
                    onPointerEnter={() => !item.disabled && setHighlight(i)}
                    onClick={() => selectAndClose(item)}
                  >
                    {item.label}
                  </div>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
