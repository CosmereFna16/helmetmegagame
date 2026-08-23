# Web design system

How the web app is styled, and the rules for adding to it. Source of truth for
exact *values* is `web/app/globals.css` and the font setup in
`web/app/layout.js` — this doc is a map of what's there and how to use it, not
a copy of the values. Keep it that way; a duplicate goes stale.

Product bar: **functionality, usability, cleanliness, responsiveness, browser
performance.** The explicit reference point to avoid is the typical slow,
laggy Discord bot dashboard.

## 1. Fonts

Four faces loaded via `next/font/google` in `layout.js`, exposed as CSS
variables on `<html>`:

| Variable | Face | Use |
|---|---|---|
| `--font-sans` | Source Sans 3 | The app default, set on `body`. Chrome, tables, forms, buttons and prose. |
| `--font-mono` | IBM Plex Mono | **Data only** — numbers, resources, dice, IDs, timestamps, audit rows. Opt in with `.mono`. |
| `--font-serif` | Source Serif 4 | Applied automatically to every `h1`/`h2`/`h3` by a global rule. |
| `--font-display` | UnifrakturMaguntia | Blackletter, reserved for a few thematic moments — the login wordmark and a couple of flavor-heavy titles — via `.font-display`/`.wordmark`. |

Three rules that are easy to get wrong:

- **Never hand-apply a font class to a heading.** Just use the tag; the global
  rule handles it. Source Serif 4 and Source Sans 3 are a designed
  superfamily, so they share metrics for free.
- **Don't reach for mono for prose.** It was the body face once, which made it
  wallpaper — dense GM tables got wider and harder to read, and the mono
  signalled nothing because everything was mono.
- **Never use `--font-display` for bulk headings, loading-state text, or
  player-authored content.** It's illegible at small sizes and reads as a
  mismatch everywhere but the few places it's deliberate.

## 2. Colour

Entirely CSS custom properties, redefined per-theme in `globals.css`. **Never
hardcode a hex or rgb value in a component** — always `var(--x)`, so it tracks
the active theme. There are currently zero hardcoded colours app-wide; keep it
that way.

Three things about the token set are load-bearing and easy to undo by accident:

- **The surface ladder is `--bg` → `--surface` → `--surface-raised`**, each
  step keeping ~1.20 contrast. `.panel` sits on `--surface`; modals, tooltips,
  sticky table headers and the turn chip sit on `--surface-raised`.
  `--field-bg` is *recessed below* the surface, so inputs read as cut into a
  panel rather than as another panel stacked on it. At 1.08 the whole app read
  as one flat sheet, which is what this spacing fixes. `--panel-bg` survives
  only as a legacy alias for `--surface`.
- **`--accent` and `--accent-text` are different colours on purpose.**
  `--accent` is a fill or rule; `--accent-text` is for text and outlines. One
  ember token cannot be both legible and rich — collapsing them makes every
  button in the app fail AA. Similarly `--accent-solid` + `--on-accent` are the
  primary button pair, and **`--danger`, not `--accent`, is for destructive
  actions**.
- **Contrast is gated, not vibes.** `npm run audit:contrast --workspace=web`
  parses the theme blocks straight out of `globals.css` and fails on any AA
  regression. Run it after touching a colour.

## 3. Themes

`dusk` and `dawn` follow the current turn's phase via `themeForPhase`. Both are
*underground darks* — Ravenheart is a cave civilisation, so they differ by
lamplight temperature and lift, not by daylight.

`limestone` is a light-theme backup that no phase maps to; reach it with
`LIFEWEB_THEME=limestone` (`resolveTheme` in `web/lib/turnFormat.js`, applied in
`layout.js`).

A CRT/terminal look is a parked option, written up in `CRT-TERMINAL.md`. **Read
that before rebuilding it** — it has been half-built and deleted twice.

## 4. Tailwind bridge

Tailwind is bridged to the tokens via the `@theme inline` block in
`globals.css`. That's what makes `text-sm`/`text-lg` resolve to the design
scale rather than Tailwind's stock sizes, and what makes `text-muted`/
`bg-surface` real utilities.

Prefer those utilities over an inline `style={{ color: "var(--muted)" }}` in new
code — the app still carries ~160 such objects and they're retired as pages are
touched.

**When overriding a size token in `@theme`, always pair it with its
`--text-<size>--line-height`**, or the utility falls back to a ratio computed
against the size you just replaced.

## 5. Shared classes

Use these instead of rolling one-off markup.

| Class | For |
|---|---|
| `.panel` | Any card/section container. |
| `.panel-header` | Its heading — serif `--fs-lg` with a hairline rule. |
| `.section-title` | A heading that is a **flex child beside something else**. |
| `.btn` | Solid primary button. |
| `.btn-secondary` | Outline. |
| `.btn-danger` | Destructive — Reject, Kill, Restart Game. |
| `.btn-quiet` | Text-only. |
| `.field` | Wraps a `.field-label` + input/textarea/select. |
| `.chip` | Small tag/pill labels. |
| `.data-table` | Tabular data. |
| `.menu-item` | Link-like row actions. |
| `.modal-overlay` / `.modal-panel` | Modals — normally via `useConfirm()`. |

Two of these carry a trap:

- **`.field` is not optional.** It is how *every* form control gets themed
  (background, border, font). A bare `<select>`/`<input>` outside `.field`
  falls back to unstyled native browser chrome and visibly breaks the theme —
  wrap it even for a single standalone control.
- **`.panel-header` vs `.section-title`.** Use `.section-title` wherever the
  heading sits beside something else — a modal title next to its close button,
  a status band next to its value, a "Tags" heading next to its buttons.
  `.panel-header`'s `border-bottom` would underline just the title text there
  rather than spanning the container, which reads as an underline, not a divider.

Pick a button variant by how important the action is, rather than defaulting to
`.btn` everywhere.

## 6. Page shell

`web/app/components/PageShell.js` — a component, not a convention. Every
top-level page is:

```jsx
<PageShell width>
  <PageHeader title subtitle actions />
  …
</PageShell>
```

`width` is `narrow` / `default` / `wide`, and that's the whole menu — it
replaced five ad-hoc `max-w-*` values chosen per page. `PageHeader`'s `actions`
slot takes anything belonging beside the title: a sub-nav, a faction switcher.

**Don't hand-roll `mx-auto flex max-w-… p-6 sm:p-8` or a bare `<h1>`.** That
was a documented convention for months and drifted anyway, which is why it is
now a component.

A page's `loading.js` is `<SkeletonPage width title panels />` from the same
file, so a skeleton physically cannot disagree with its page about width or
title. `panels` is an array of bar-width percentages roughly tracing what
lands. The one exception is `web/app/(app)/loading.js`, the group fallback: it
renders no title, because it can't know which page is arriving.

## 7. List shell

Every long list in the app is the same object.
`web/app/components/DataTable.js` is the single engine —
`useTableState({rows, searchFields, filterDefs, initialSort, pageSize})`
returning `pageRows`/`page`/`setPage`/`total`/`totalPages` alongside the
filtered `visible`, plus `SortHeader`, `FilterBar` and `TableScroll`.
`web/app/components/Pager.js` is the one pager.

Three things about it are load-bearing:

- **Paging is client-side everywhere except `/gm/audit` and `/archive`**, which
  page server-side over `?page=` so a filtered view stays linkable. That's why
  `Pager` has **no `"use client"` directive** and takes precomputed
  `prevHref`/`nextHref` there instead of the `onPage` callback the in-memory
  tables pass — a function prop cannot cross a server→client boundary.
- **Changing the search, a filter or the sort resets to page 1 inside the
  setters, never in an effect.** `react-hooks/set-state-in-effect` is an error
  in this repo, and the setter version lands in the same render anyway.
- **List height is one token, `--list-h`**, shared by `.table-scroll` (tables),
  `.list-scroll` (the `/notes` card board) and `.message-list` (a DM thread).

A card list with no header row to hang a `SortHeader` off passes `sortOptions`
to `FilterBar` instead, which is what `/notes` does.

## 8. Confirm dialog

For any "are you sure?" moment, use the shared dialog rather than a one-off
modal or `window.confirm`. `web/app/components/ConfirmProvider.js` mounts once
in `web/app/layout.js` and exposes `useConfirm()`:

```js
const confirm = useConfirm();
if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;
```

All fields are optional, and it reuses `.modal-overlay`/`.modal-panel` so it
matches every other modal for free.

### Confirm first, transition second — always

**Never `await confirm()` inside `startTransition(async …)`.** This has now bitten
three separate components, so it is written down here rather than only in the
comments of the files that hit it.

`confirm()` resolves on a click, so the state update that mounts the dialog has
to render *immediately*. Inside an async transition scope React schedules that
render at transition priority — and the transition cannot commit until the
promise settles, while the promise cannot settle until someone clicks a dialog
that was never committed. The result is a deadlock: the dialog never appears,
`isPending` stays true forever, every control bound to it sits disabled, and the
server action is never called at all. Only a refresh escapes, which throws away
any unsaved state.

```js
// WRONG — deadlocks, and looks like "the button does nothing"
startTransition(async () => {
  if (!(await confirm({ ... }))) return;
  await doTheThing();
});

// RIGHT — human first, transition second
if (!(await confirm({ ... }))) return;
startTransition(async () => {
  await doTheThing();
});
```

The rule of thumb: a transition may wrap the *server call*, never a wait on the
*user*. If a `run()`-style helper exists, only ever hand it a function that does
no user interaction.
