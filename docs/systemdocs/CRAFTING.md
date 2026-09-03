# Crafting, Destroy, and the capability flags

The Craft button on `/character` (it replaced Add Tag), the Destroy button
(it replaced Remove Tag), multi-turn projects, and the four flags on `Tag`
that decide which menu a tag sits in.

## 1. The four flags

Every player tag menu is one boolean in `docs/tags.yaml`, re-checked
server-side by the matching request. None is derived from the category.

| Flag | Menu | Re-check |
|---|---|---|
| `craftable` | Craft | `craftRequest` (`character/requestActions.js`) |
| `removable` | Destroy | `destroyTagRequest` |
| `healable` | Heal | `healCharacterRequest` via `web/lib/healRequests.js#isHealable` |
| `teachable` | Learn / Teach | `db/lib/lessons.js#teachableSkills` (LESSONS.md) |

The 9/2026 sweep set `healable: true` on every health tag with a cure,
`removable: false` on every health tag (a wound is healed, not thrown away —
a condition nobody can cure runs its course or waits for a medic), and
`teachable: true` on every skill. `docs/tags.yaml`'s header documents each
key. Harm's menu is the one that still reads the category
(`INFLICTABLE_GROUPS` / `INFLICTABLE_SLUGS`, a curated list).

## 2. A recipe

A craftable tag's `requirement:` block is the recipe, and Craft enforces all
of it:

- `skills` — every listed skill, or a higher tier of it, must be held
  (`db/lib/medicalVision.js#satisfiedSkillIds`, the same walk Heal uses).
  The page decides this per recipe (`knownRecipeIds`) and the menu shows only
  those; the server re-checks.
- `resourceCost` — ⬢ per unit, **charged when the work starts**, never
  refunded on cancel or on undo-by-GM of a mid-project turn. Paid by
  **yourself, a Room stash here, or a person standing here** (payer select;
  a person is DM'd "*X paid N ⬢ from your purse toward Y*").
- `turnsCost` — Moves of work. **0** is Dead Simple: no Move, rationed to
  `DEAD_SIMPLE_PER_TURN` units a turn (SMITHING.md §2). **1** is this turn's
  Routine. **2+** is a project (§3).
- `perTurn` — units of this recipe one character may make in a turn, counted
  per recipe. Only meaningful at `turnsCost: 0`; omit it and a Dead Simple
  recipe falls back to the shared `DEAD_SIMPLE_PER_TURN` pool of 4.
- `gambit` is ignored: crafting is always a Routine. The sweep cleared it on
  the two brews that carried one (BREWING.md).

**Smith's work also needs a forge.** A recipe naming a `smithing-*` or
`builder-*` skill requires Workshop Equipment in reach — held, or set up in a
room you can get into where you stand (`db/lib/equipmentReach.js`). See
[`SMITHING.md`](SMITHING.md) §2a; `needsWorkshop()` in
`web/lib/tagRequests.js` is the shared predicate, so the dialog and the server
cannot disagree.

The purchase-side checks still apply — prerequisite chain, exclusivity,
`conflictsWith`, "already hold a higher tier", non-stackable duplicates
(`craftGrantChecks`). A finished tag lands with `TagSource.CRAFT`, its clock
stamped by `expiryForGrant`, the tiers below it replaced.

## 3. Projects

```
CraftProject { characterId, tagId, quantity, turnsNeeded, turnsDone, resourcesCost,
               payerKey, payerName, status ACTIVE|DONE|CANCELLED, startedTurnId, lastTurnId, requestId }
```

A table, not an "in progress" pseudo-tag: it has a counter, a payer and a
link to the Move that last advanced it, and a tag would show on 🔍 inspect
and count toward carry.

- **Start** (`craftRequest`, `turnsCost ≥ 1`): needs a free Move slot
  (`moveWindow` open, no Action this turn); charges the payer; creates the
  project at `turnsDone: 1`; files the Action — `ROUTINE`, `CONFIRMED`,
  `PASSED`, `appliedEffects: {}`, `gmNotes: "auto:craft"`, description
  "Crafting 4× Arrow (1/3). ‡". A one-turn recipe finishes on the spot.
- **Continue** (`continueCraft`): the Craft dialog lists active projects;
  pick one, choose *Keep working on it*. Same Move check; one advance per
  turn (`lastTurnId`); a claim on `turnsDone` so two clicks can't double an
  advance. Turns needn't be consecutive. The recipe's skills are re-checked —
  losing the skill stops the work where it stands.
- **Finish**: the last advance grants the tag and writes the `ADD_TAG`
  Request (`effect { tagId, quantity, resourcesSpent, payer, projectId,
  turnsNeeded, actionId, replaced }`), and the Action reads "Crafted …".
- **Cancel** (`cancelCraft`): status CANCELLED, audit `craft_cancelled`, no
  refund. Death cancels ACTIVE projects (`characterDeath.js`).

The only Request is the completion. Mid-project turns leave audit rows
(`craft_started`, `craft_continued`) and the Actions themselves, which the
desk shows like any Routine.

## 4. Undo

`web/lib/requestEffects.js` `ADD_TAG.undo`: the tag comes off, replaced tiers
come back, `resourcesSpent` is refunded to `effect.payer` (an older row
without one refunds the character), and a project is marked CANCELLED. The
auto-filed Actions stay — a GM who wants the Move back uses Reject.

## 5. Destroy

`destroyTagRequest`: drops a `removable` tag you hold, rolls `removesInto`
aftermath, files `REMOVE_TAG`. No ⬢ field any more and nothing refunded — the
`/store` loophole rule (a negative-cost tag must be removable or consumable)
still relies on the Beliefs staying `removable`.

## 6. Where the code lives

| Thing | File |
|---|---|
| Craft / Continue / Cancel / Destroy actions | `web/app/(app)/character/requestActions.js` |
| Recipe list and projects for the page | `web/app/(app)/character/page.js` (`knownRecipeIds`, `craftProjects`) |
| Dialog | `web/app/components/CraftDialog.js`, `RequestActionsProvider.js` (`craft`, `destroy`) |
| Menu filters | `web/lib/tagRequests.js` (`craftableTags`, `destroyableTags`), `web/lib/healRequests.js` (`isHealable`) |
| Flags in sync | `db/lib/syncTags.js`; catalog `docs/tags.yaml` |
| Kit in reach | `db/lib/equipmentReach.js`, `web/lib/tagRequests.js#needsWorkshop` |
| Tier replacement | `db/lib/tagWrites.js#replaceLowerTiers` |
| Desk | `web/app/(desk)/gm/turns/RequestSections.js` (Craft ‡ / Destroy ‡), `web/lib/requestLabels.js` |
