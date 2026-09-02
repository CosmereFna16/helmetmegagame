"use client";

import IconButton from "./IconButton";
import { useRequestActions, ACTION_HELP } from "./RequestActionsProvider";
import {
  PlusIcon,
  TrashIcon,
  HandOffIcon,
  ResourcesIcon,
  MealIcon,
  BandageIcon,
  LootIcon,
  MapIcon,
  ShackleIcon,
  KeyIcon,
  WoundIcon,
  GraveIcon,
  BirdIcon,
  EyeIcon,
} from "./icons";

// Everything a player can do to a sheet, as one block of icons on the right
// of the Status panel. Before this the same actions were spread over three
// surfaces — a text button row in the Tags panel, a Transfer Resources button
// in the Status footer, and a whole separate "Bodies here" panel — and two
// of them (Loot, Move) had shipped server-side with no button at all.
//
// A GRID, not a vertical strip. A single column of eleven icons would run
// far past the four rows of the <dl> beside it and drag the panel's height
// with it; four across keeps the block roughly as tall as what it sits next
// to. Below `sm` it drops underneath at full width.
//
// Order is by how often it gets used, reading left to right: the tag verbs
// first, then the things you do to other people, then the rarest.

// The metagaming rule: a button is greyed out ONLY for a fact about your own sheet — nothing to
// remove, nothing to hand over, no Medical training. It is NEVER greyed for a
// fact about who is standing near you.
//
// That distinction is the whole point. A greyed-out Loot icon would announce
// "nobody here is helpless" to anyone who glanced at their own sheet, and a
// live one would announce the opposite — free scouting, every time the page
// loads, without anyone choosing to look. It is the same reasoning
// REQUESTS.md §3 gives for leaving the transfer dropdowns unfiltered: the
// menus are advisory, the server is the gate, and a filtered menu is a
// disclosure. So the co-presence actions are always lit, and you only learn
// who is here by opening the dialog and reading it.
const ACTIONS = [
  {
    mode: "add",
    icon: PlusIcon,
    label: "Add Tag",
    help: ACTION_HELP.add,
    gate: "canAdd",
  },
  {
    mode: "remove",
    icon: TrashIcon,
    label: "Remove Tag",
    help: "Cure yourself or drop an item.",
    gate: "canRemove",
  },
  {
    mode: "transfer",
    icon: HandOffIcon,
    label: "Transfer Tag",
    gate: "canTransfer",
  },
  {
    mode: "resources",
    icon: ResourcesIcon,
    label: "Transfer Resources",
    help: ACTION_HELP.resources,
  },
  {
    mode: "consume",
    icon: MealIcon,
    label: "Consume",
    help: ACTION_HELP.consume,
    gate: "canConsume",
  },
  {
    mode: "heal",
    icon: BandageIcon,
    label: "Heal",
    help: ACTION_HELP.heal,
    gate: "canHeal",
  },
  { mode: "loot", icon: LootIcon, label: "Loot", help: ACTION_HELP.loot },
  { mode: "move", icon: MapIcon, label: "Move Player", help: ACTION_HELP.move },
  { mode: "bind", icon: ShackleIcon, label: "Bind", help: ACTION_HELP.bind },
  { mode: "free", icon: KeyIcon, label: "Free", help: ACTION_HELP.free },
  { mode: "harm", icon: WoundIcon, label: "Harm", help: ACTION_HELP.harm },
  // No gate: burying is a co-presence action, and the rule above forbids
  // greying a button for a fact about who is near you. You learn whether a
  // body is here by opening the dialog and typing a name.
  {
    mode: "bury",
    icon: GraveIcon,
    label: "Bury Person",
    help: ACTION_HELP.bury,
  },
  // The Bird's two, and the only entries here that HIDE rather than grey.
  //
  // That is not a break in the rule above, which is about facts concerning
  // other people: owning a bird and being able to write are both facts about
  // your own sheet, so either treatment would be legal. Hiding is chosen
  // because these two are rare — most of the roster holds neither tag, and a
  // permanently dead icon teaches nothing except that something exists which
  // you cannot have. `gate` still applies on top: Send Bird greys once today's
  // letter has gone, which is a state worth showing rather than hiding.
  {
    mode: "bird",
    icon: BirdIcon,
    label: "Send Bird",
    help: ACTION_HELP.bird,
    show: "hasBird",
    gate: "canSendBirdToday",
  },
  // The only entry in this grid that files no Request. It has no server
  // action, no cooldown and writes nothing — it is a local box that decodes a
  // ciphered letter someone showed you. Don't go looking for the missing
  // action; there isn't one. See docs/systemdocs/BIRD.md.
  {
    mode: "read",
    icon: EyeIcon,
    label: "Read",
    help: ACTION_HELP.read,
    show: "isLiterate",
  },
];

// The tooltip is the label plus, where there is one, the sentence explaining
// what the action actually does — IconButton already renders `label` through
// Tooltip, so hovering tells you what a glyph means without a second control.
function tooltipFor({ label, help }) {
  if (!help) return label;
  if (typeof help !== "string") {
    return (
      <>
        <p>
          <strong>{label}</strong>
        </p>
        {help}
      </>
    );
  }
  return (
    <>
      <p>
        <strong>{label}</strong>
      </p>
      <p>{help}</p>
    </>
  );
}

export default function ActionGrid() {
  const actions = useRequestActions();
  if (!actions) return null;
  const { open, pools } = actions;

  return (
    <div>
      <p className="field-label mb-2">Actions</p>
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-4">
        {ACTIONS.filter((a) => (a.show ? pools[a.show] : true)).map((a) => (
          <IconButton
            key={a.mode}
            icon={a.icon}
            label={a.label}
            tooltip={tooltipFor(a)}
            onClick={() => open(a.mode)}
            disabled={a.gate ? !pools[a.gate] : false}
          />
        ))}
      </div>
    </div>
  );
}
