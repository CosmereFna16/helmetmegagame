# Rework 2 — Adjudication, Requests, Moves, Mood

> Note: This may be too big for one project if it is htats fine let me know and we'll split it.
> Reference: see `Characters.md` in systemdocs for the character creation system this builds on.

## Overview

We're reworking game systems one by one. Character creation is done. Next up:

- **Adjudication and Requests page** (hosts both the Moves and Requests systems)
- **Mood System**

- Later: the character panel itself, and the **Dev Player Edit** panel (GM tool for editing character sheets, accessed through adjudication and several other places)

The old adjudication system has been removed. What remains is the "move sent" functionality — this needs to be spliced with the new system described below.

For each system reworked, produce a `Systemdoc.md` explaining the architecture.

---

## 1. Adjudication Page

One page, two tabs at the top, each tab showing a different screen:

- **Moves** — types: Gambit, Routine; Opposed: Yes/No
- **Requests** — Fulfill Desire, Add Tag, Remove Tag, Transfer Resources (keep this extensible for more request types later)

Both tabs use a **static, long table** with both horizontal (side) and vertical scrolling.

### 1a. Moves Tab

Table columns:

- Turn the move happened in
- Character name
- Discord username
- Faction
- Move description (text wraps, 100-character limit)
- Status: **Open** (black text), **In Progress** (orange text), **Solved** (green text)
- GM notes column

Left-side buttons per row:

- **Balance scale icon** (framed, uses the site's standard "button alt color" state like other buttons) → opens the **Adjudication Panel**
- **Message button** → sends a message

### 1b. Requests Tab

Same general table shape as Moves, with differences:

- Icon is an **Edit icon** instead of the balance scale
- Column is **Reason** instead of description
- Status: **Passed** (default), **Edited** (red text), **Undone** (red text) — changes when the GM uses the Edit icon
- GM notes column

Both tabs add filters, sort, and search.

---

## 2. Adjudication Panels

Shared architecture for both panel types:

- Exiting the panel in **any way** other than explicitly saving first brings confirm.js (ya sure ya wanna close?) doing that browser hijack thing, reverts all edits/changes.

### 2a. Move Adjudication Panel

Flow: **Adjudication Panel → Move Panel → Move Type Panel** (second half of the panel is context-dependent based on move type: Routine, Location Change [**open question**: confirm whether location changes are currently handled as a Routine move or as their own type — follow whichever is current], or Gambit).

### 2b. Request Adjudication Panel

Flow: **Adjudication Panel (Request Panel) (Request Type Panel)**

- Top section is universal Request Panel: shows all necessary info about the request, along with a very small font saying exactly the following: "To reduce GM load, players can make big changes."
- Bottom section is context-dependent, with a heading naming the request type: **Fulfill Desire**, **Add Tag**, **Remove Tag**, **Transfer Resources**, **Set Mood**.
  - **Fulfill Desire**: shows the desire that was fulfilled and how many points were awarded

Three buttons at the bottom (each with a hover tooltip):

1. **Confirm** — marks status as Edited and applies the changes
2. **Undo** — resets the action and marks status as Undone
3. **Cancel** — leaves status as Passed, discards all edits

---

## 3. Requests System (Concept)

**Goal:** reduce GM load. Players constantly take actions — sending/taking resources, adding/removing tags, setting and completing desires, declaring mood, etc. Many of these actions shouldn't strictly require player permission, but forcing a GM approval step first creates delay.

**Solution:** players can act immediately and must supply a reason. The GM reviews after the fact.

Flow:

1. Any action that triggers a request opens a **universal popup**: "What is your reason?" (shown to GMs later)
2. Optional context depended second panel
3. Player clicks **Confirm**
4. The request is **auto-approved and takes effect immediately**
5. GM reviews it later in the Requests tab/panel and can **Undo** or **Edit** as needed

### Audit Log changes (to support Requests)

1. Side-scrolling capability
2. Preset height (tall)
3. Vertical scrolling
4. New column: **Reason** (used only for request entries)

---

## 4. Tag System Rework

- Players need the ability to edit their own tags, within limits, to reduce GM load.
  - Example: if a medic treats a player and removes their illness, the player should be able to remove that tag themselves.
- Add an **Make Tag** and **Remove Tag** button to the tag area of the character sheet. You can use the point buy architecture generally but obviously different, no points.s
  - **Make Tag**: only things with the craftable tag.
  - Both Add Tag and Remove Tag route through the general `request.js` system.
  - **Add Tag** additionally needs a "Does this cost any resources?" input in the request panel. just a number box
  - **Remove Tag** additionally needs a "Does this cost any resources?" input in the request panel. just a number box

---

## 5. Mood System

Fully independent system — not tied to any other source (ignore existing Happiness/Unhappiness references throughout the docs; this replaces them).

**Design the architecture first.** Known player-facing requirements:

- Lives on the **Status sub-panel**.
- Display: `Mood: Neutral (black) / Happy (green) / Unhappy (red)` plus `(# turns left)` in black text.
- **Happy** → +1 to die roll on all Gambits.
- **Unhappy** → -1 to die roll on all Gambits.
- Moods are **freely declared** by the player:
  - Click **Set Mood** button → request.js, first half is universal reason, second one is a mood dropdown
- Moods **last 2 turns** and **auto-expire**.
- moods should integrate into the tag system as expiry 2, not addable not removable not purchasable, in the status category. only way to access them is through GM or the set mood panel. populate the Happy and Unhappy tag in .yaml
- add a transfer tag request button as well, can only send tags (assets and items ONLY) not request to prevent abusing by seeing what the player has. same request area, second half dropdown with your item / asset tags and select destination (person, alphabetical)

---

## 6. Status Panel Changes

### Send Resources

Current system is functional but needs one addition: a **source** field.

- Currently: presumably a fixed/implicit source.
- New: players press a button, opening request, reasoning box, choose a source to send resources **from** (e.g., from any faction silo, or from any player to themselves. Alphabetical, 2 groups—faction and players. Dont group players under factions, that can spoil allegiances.) and how many.
- Rename it to transfer resources

### General Cleanup

Since the Status panel is gaining a lot of new content (Mood, updated Send Resources), give the overall layout a structural touch-up — alignment, spacing, etc. Feel free to redo the structure if that's the better call.

---
