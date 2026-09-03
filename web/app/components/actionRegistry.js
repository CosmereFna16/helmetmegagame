// Every player action on the character sheet, declared once.
//
// ActionGrid.js renders these as captioned rows; RequestActionsProvider.js
// reads each mode's title and help from here. Adding an action to the game
// is one object literal in a section below, one dialog branch in the
// provider, and one server action — nothing else has to change, and the
// grid never has a fixed column count to overflow.
//
// The metagaming rule: a button is greyed out ONLY for a fact about your own
// sheet — nothing to destroy, no recipe you know, no Medical training. It is
// NEVER greyed for a fact about who is standing near you. A greyed-out Loot
// icon would announce "nobody here is helpless" to anyone who glanced at
// their own sheet, and a live one would announce the opposite — free
// scouting, every time the page loads. So the co-presence actions are always
// lit, and you learn who is here by opening the dialog and reading it. (The
// pickers themselves list only the people at your Location who haven't hidden
// their face — web/lib/peopleHere.js — which is a different rule: what the
// dialog shows once you chose to look.)
//
// `gate`: a key on the provider's pools that greys the button when false.
// `show`: a key that HIDES the button instead — for the rare tags (a bird,
// literacy) where a permanently dead icon would teach nothing except that
// something exists which you cannot have.
import {
  HammerIcon,
  TrashIcon,
  HandOffIcon,
  MealIcon,
  BandageIcon,
  LootIcon,
  MapIcon,
  ShackleIcon,
  KeyIcon,
  WoundIcon,
  GraveIcon,
  CleaverIcon,
  HeadstoneIcon,
  BirdIcon,
  EyeIcon,
  DocumentsIcon,
  SpeakerIcon,
} from "./icons";

export const ACTION_HELP = {
  craft:
    "Make something from a recipe you know. The ⬢ are charged now, your Move is filed for you, and a long job comes back here to continue. ‡",
  destroy: "Throw away something you're holding. It's gone. ‡",
  examine:
    "Look someone over without saying a word to them. You see what anyone standing here could see — their face, and whatever they are carrying openly. Somebody concealed stays concealed. Costs nothing, takes no time, and they are never told. ‡",
  heal: "Works on others nearby too. Gated by your Medical skill.",
  consume: "Use something up. You can also just click on the tag on your sheet.",
  transfer: (
    <>
      <p>Hand over things and ⬢, or stash them in a room and pick them up later. ‡</p>
      <p>
        <strong>To a person</strong> They have to be standing where you are. You can&apos;t take from a person
        &mdash; that&apos;s Loot. ‡
      </p>
      <p>
        <strong>To or from a room</strong> Be standing in it. Anyone who can get in can take what&apos;s there. ‡
      </p>
    </>
  ),
  learn:
    "Ask someone here who can teach to show you a skill. If they accept, it's your Gambit for the turn — a 5 or 6 and it's yours. ‡",
  teach: "Offer to teach someone here a skill you have. It's your Routine for the turn once they accept. ‡",
  loot: "Search someone. Only works on a body, or on someone Bound, Dying, Paralyzed or Catatonic. ‡",
  move:
    "Forcibly move someone with the Bound tag, from where you stand to somewhere next door. Use this before moving yourself. If you're a Leader, you can also move people within your own faction. It does not spend their turn. Bodies can be dragged by anyone. ‡",
  bind: "Tie someone up. They have to agree — unless they're already helpless. Once they're Bound you can loot them or march them somewhere. ‡",
  free: "Cut someone loose. Anyone standing here can do this, including a rescuer.",
  harm: "Further injure someone who is bound or incapacitated.",
  butcher:
    "Cut up a body — one you're carrying, or one lying in a room you can get into here — for what's inside it. Costs nothing and takes no time, and the body is gone afterwards. It does not free their soul. ‡",
  bury:
    "Put a body in the ground. You have to be holding their corpse, or be somewhere you can reach it. Takes your turn. Allows their soul to respawn. ‡",
  engrave:
    "Memorialize someone's name, in case you can't find their body. Frees their soul to respawn. ‡",
  bird: "Send a bird to someone. You have to guess their zone. If they are illiterate, they'll need help reading it.",
  read: "Decode a letter someone showed you. Paste the script and it turns back into words. Nobody is told you read it.",
};

export const ACTION_SECTIONS = [
  {
    key: "self",
    label: "You ‡",
    actions: [
      { mode: "craft", icon: HammerIcon, label: "Craft ‡", gate: "canCraft" },
      { mode: "destroy", icon: TrashIcon, label: "Destroy ‡", gate: "canDestroy" },
      { mode: "consume", icon: MealIcon, label: "Consume", gate: "canConsume" },
      // No gate: you can always move ⬢ or put something down.
      { mode: "transfer", icon: HandOffIcon, label: "Transfer ‡" },
      // Both grey on a list the server already filtered to who could teach
      // YOU (or whom you could teach) — a fact about your own sheet.
      { mode: "learn", icon: DocumentsIcon, label: "Learn Skill ‡", gate: "canLearn" },
      { mode: "teach", icon: SpeakerIcon, label: "Teach Skill ‡", gate: "canTeach" },
    ],
  },
  {
    key: "others",
    label: "People here ‡",
    actions: [
      // No gate, and never one: whether there is anybody to look at is a fact
      // about who is standing near you, which the rule at the top of this file
      // forbids greying a button for.
      { mode: "examine", icon: EyeIcon, label: "Look at ‡" },
      { mode: "heal", icon: BandageIcon, label: "Heal", gate: "canHeal" },
      { mode: "loot", icon: LootIcon, label: "Loot" },
      { mode: "bind", icon: ShackleIcon, label: "Bind" },
      { mode: "free", icon: KeyIcon, label: "Free" },
      { mode: "harm", icon: WoundIcon, label: "Harm" },
      { mode: "move", icon: MapIcon, label: "Move Player" },
    ],
  },
  {
    // The three body actions, together and out of "People here": a corpse is
    // an object lying in a room, not a person standing next to you, and
    // Butcher works on a Nekker as readily as on somebody's uncle.
    key: "dead",
    label: "The dead ‡",
    actions: [
      // Greys only on whether YOU hold the Butcher tag — a fact about your own
      // sheet, which the metagaming rule above allows. Never on whether
      // there's a body nearby; you find that out by opening the dialog.
      { mode: "butcher", icon: CleaverIcon, label: "Butcher ‡", gate: "canButcher" },
      { mode: "bury", icon: GraveIcon, label: "Bury Person" },
      // Engraving types a name rather than picking one — the reasoning that
      // used to sit on Bury, and it applies harder here: this searches every
      // zone, so a dropdown would list every unburied body in Ravenheart.
      { mode: "engrave", icon: HeadstoneIcon, label: "Engrave ‡" },
    ],
  },
  {
    key: "letters",
    label: "Letters ‡",
    actions: [
      { mode: "bird", icon: BirdIcon, label: "Send Bird", show: "hasBird", gate: "canSendBirdToday" },
      // The only entry that files no Request: a local box that decodes a
      // ciphered letter. See docs/systemdocs/BIRD.md.
      { mode: "read", icon: EyeIcon, label: "Read", show: "isLiterate" },
    ],
  },
];

const BY_MODE = new Map(ACTION_SECTIONS.flatMap((s) => s.actions).map((a) => [a.mode, a]));

// The dialog title and submit label for a mode — the button's own name.
export function titleFor(mode) {
  return BY_MODE.get(mode)?.label ?? "Request";
}

export function helpFor(mode) {
  return ACTION_HELP[mode] ?? null;
}
