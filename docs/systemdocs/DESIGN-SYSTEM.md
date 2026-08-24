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
  regression. Run it after touching a colour. It also **scans `web/app` and
  `web/lib`** for `var(--accent)` used as anything but a fill or a rule — an
  allowlist, not a denylist, because the worst offender was `costColor()`
  handing the token to six callers to spend as text, which no denylist could
  attribute. `--accent` as text measures **2.96** on dusk's `--surface`: under
  not just AA's 4.5 but the 3.0 large-text floor.
- **Each theme names its own `color-scheme`.** A handful of controls are drawn
  by the browser, not by `globals.css` — the unchecked checkbox, the date
  picker's calendar glyph and popup, the search field's clear button, the
  `<select>` option list, the scrollbars. They read that property and nothing
  else, so without it a native `<select>` popup opens white in dusk.

## 3. Themes

`dusk` and `dawn` follow the current turn's phase via `themeForPhase`. Both are
*underground darks* — Ravenheart is a cave civilisation, so they differ by
lamplight temperature and lift, not by daylight.

`limestone` is a light-theme backup that no phase maps to; reach it with
`BASCINET_THEME=limestone` (`resolveTheme` in `web/lib/turnFormat.js`, applied in
`layout.js`).

A CRT/terminal look is a parked option, written up in `CRT-TERMINAL.md`. **Read
that before rebuilding it** — it has been half-built and deleted twice.

## 4. Tailwind bridge

Tailwind is bridged to the tokens via the `@theme inline` block in
`globals.css`. That's what makes `text-sm`/`text-lg` resolve to the design
scale rather than Tailwind's stock sizes, and what makes `text-muted`/
`bg-surface` real utilities.

Prefer those utilities over an inline `style={{ color: "var(--muted)" }}` in new
code — the app still carries ~80 such objects and they're retired as pages are
touched. What is left is mostly *computed*: a group colour, `costColor()`, a
map coordinate. A utility class cannot express those, so they stay.

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
| `.control` | The `.field` control surface, without the label column — a `<select>` in a table cell, an input inline in a toolbar. |
| `.icon-btn` | The one framed icon button — via `IconButton`. |
| `.tab-item` / `.tab-bar` | A tab strip navigating between panels. Keyed on `data-active`. |
| `.segmented` | A group of mutually exclusive options as one joined pill. Keyed on `aria-pressed`. |
| `.select-card` | A `.panel` you pick. Selection is `aria-pressed`. |
| `.check-row` / `.switch-row` | A boolean and its label — via `CheckField` / `Switch`. |
| `.status-pill` | A state, coloured by `data-tone`. |
| `.empty-state` | "Nothing here" text. |
| `.form-error` | Something went wrong. Always `--danger`. |
| `.modal-overlay` / `.modal-panel` | Modals — **always** via `Modal`, usually via `useConfirm()`. |

Three of these carry a trap:

- **`.field` is not optional.** It is how *every* form control gets themed
  (background, border, font). A bare `<select>`/`<input>` outside `.field`
  falls back to unstyled native browser chrome and visibly breaks the theme —
  wrap it even for a single standalone control.
- **`.panel-header` vs `.section-title`.** Use `.section-title` wherever the
  heading sits beside something else — a modal title next to its close button,
  a status band next to its value, a "Tags" heading next to its buttons.
  `.panel-header`'s `border-bottom` would underline just the title text there
  rather than spanning the container, which reads as an underline, not a divider.
- **`.tab-item` and `.segmented` are not the same idea.** A tab strip navigates
  between panels and is keyed on `data-active`, a styling hook. A segmented
  control has a *value*, so its pressed state lives in `aria-pressed`, where a
  screen reader can reach it. Picking by looks gets the semantics wrong.

Pick a button variant by how important the action is, rather than defaulting to
`.btn` everywhere.

## 5a. The five that had no rule

These drifted precisely because this document never said anything about them —
seven wrappers for a checkbox, eight ways to show a status, twelve shapes for
an error. Each now has one component.

| Concept | Use | Never |
|---|---|---|
| A boolean | `CheckField` (a row is selected) or `Switch` (a setting is on) | A bare `<input type="checkbox">` in a hand-rolled `<label>` |
| A dialog | `Modal`, or `useConfirm()` / `RequestDialog` on top of it | `.modal-overlay` markup of your own |
| A state | `StatusPill` with a **tone**, or `EnumPill` for a DB enum | A raw enum, or a colour picked at the call site |
| Nothing here | `EmptyState`, or `EmptyRow` in a table | A bespoke `<p className="text-muted">` |
| In flight / failed | `SubmitButton` and `FormError` | A `<form action>` with no pending state |

Four things about these are load-bearing:

- **`CheckField` and `Switch` carry no `"use client"`.** Nine of the app's
  booleans are in `/gm/dev`, a *server* component posting through a form
  action; the rest are client components passing `onChange`. A directive-free
  leaf serves both. Adding one would drag every server page rendering a
  checkbox into the client bundle.
- **`Switch` keeps a real named `<input type="checkbox">`**, visually hidden
  rather than replaced, because a server `<form action>` reads its `name` on
  submit. A `<button role="switch">` looks identical and posts nothing.
- **`StatusPill` takes a tone, not a colour.** Callers say what a state *means*
  and the stylesheet decides how that looks, so a status cannot reach for a
  colour the themes have not solved. Per-domain label maps stay local — a
  Move's states are not a Request's — but they live in `web/lib/moves.js` and
  `web/lib/requestLabels.js` so *both* faces can reach them.
- **`SubmitButton` works because `useFormStatus` reads from a child.** The page
  keeps its `<form action={...}>` and stays a server component; only the button
  is a client leaf. It cannot see a button wired by `form={id}` from outside the
  form — there is no enclosing form to read.

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

All fields are optional. It renders through `Modal`, which owns the overlay,
the panel, Escape, `role="dialog"`, the focus trap and returning focus to
whatever opened the dialog — so every dialog in the app gets those whether it
asked or not. **Never hand-roll `.modal-overlay` markup**: eleven dialogs once
did, and between all of them exactly one bound Escape and one set
`role="dialog"`.

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
