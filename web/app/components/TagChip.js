import { formatCost, costColor } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { turnsLeft, formatTurnsLeft } from "@/lib/turnFormat";
import ChipLabel from "./ChipLabel";
import ChipText from "./ChipText";

// `onConsume`/`consumeHint` are set only for a consumable tag on your own
// sheet (see TagsPanel.js), which turns the chip into a shortcut into the
// Consume dialog. The name resolution behind `consumeHint` stays in the
// client parent so this component keeps rendering fine on the server
// everywhere else it's used.
export default function TagChip({
  tag,
  quantity = 1,
  onConsume = null,
  consumeHint = null,
  expiresTurn = null,
  currentTurn = null,
}) {
  const stack = quantity > 1 ? quantity : null;
  // Minified "cost to add/remove this tag in play" — see
  // Tag.requirement* in schema.prisma. Null when unset, so it's simply
  // omitted rather than rendering an empty line.
  const requirement = formatTagRequirement(tag);

  // Most tags never expire, so both of these stay null and the chip renders
  // exactly as it always did. Pass the CharacterTag's expiresTurn (not the
  // Tag's defaultDurationTurns) — the clock started when it was granted.
  const left = turnsLeft(expiresTurn, currentTurn);

  // The wrapper already carries tabIndex for the hover tooltip, so once it's
  // clickable it has to answer the keyboard too.
  const clickable = typeof onConsume === "function";

  return (
    <span
      className={clickable ? "tag-hover cursor-pointer" : "tag-hover"}
      tabIndex={0}
      role={clickable ? "button" : undefined}
      onClick={clickable ? onConsume : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onConsume();
              }
            }
          : undefined
      }
    >
      <ChipLabel tag={tag} quantity={quantity} left={left} />
      <span className="tag-tooltip" role="tooltip">
        <strong>
          {tag.name}
          {stack ? ` ×${stack}` : ""}
        </strong>
        {/* ChipText, not RichText: a {tag:…} in here resolves to a plain
            label, since a chip nested inside a hover tooltip could never be
            hovered to reach its own tooltip. */}
        {tag.description && <ChipText text={tag.description} as="p" />}
        {/* A held tag shows its real remaining turns; a catalog reference (a
            {tag:…} in prose, which has no CharacterTag behind it) falls back
            to how long it lasts when granted. */}
        {left != null ? (
          <p className="text-muted">Expiry: {formatTurnsLeft(left)}</p>
        ) : tag.defaultDurationTurns ? (
          <p className="text-muted">
            Lasts {tag.defaultDurationTurns} turn{tag.defaultDurationTurns === 1 ? "" : "s"}
          </p>
        ) : null}
        {requirement && <p className="text-muted">{requirement}</p>}
        {/* Whether another player sees this tag on the 🔍 inspect embed
            (Tag.visibleOnInspect, `visible:` in docs/tags.yaml). Only the
            affirmative renders — a hidden tag is the default, so a "Hidden"
            line on most of the catalog would be noise. */}
        {tag.visibleOnInspect && <p className="text-muted">Visible</p>}
        {consumeHint && <p className="text-accent">{consumeHint}</p>}
        <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} pts</span>
      </span>
    </span>
  );
}
