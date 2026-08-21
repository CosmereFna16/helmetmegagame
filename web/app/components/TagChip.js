import { formatCost, costColor } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";

// `onConsume`/`consumeHint` are set only for a consumable tag on your own
// sheet (see TagsPanel.js), which turns the chip into a shortcut into the
// Consume dialog. The name resolution behind `consumeHint` stays in the
// client parent so this component keeps rendering fine on the server
// everywhere else it's used.
export default function TagChip({ tag, quantity = 1, onConsume = null, consumeHint = null }) {
  // Only a stack says how many; an ordinary tag reads as a bare name, which
  // is every tag outside Items today.
  const stack = quantity > 1 ? quantity : null;
  const groupColor = tag.group?.color ?? null;
  // Minified "cost to add/remove this tag in play" — see
  // Tag.requirement* in schema.prisma. Null when unset, so it's simply
  // omitted rather than rendering an empty line.
  const requirement = formatTagRequirement(tag);

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
      <span
        className="chip"
        style={groupColor ? { borderLeftColor: groupColor, borderLeftWidth: 3 } : undefined}
      >
        {tag.name}
        {stack && (
          <span className="text-muted"> &times;{stack}</span>
        )}
      </span>
      <span className="tag-tooltip" role="tooltip">
        <strong>
          {tag.name}
          {stack ? ` ×${stack}` : ""}
        </strong>
        {tag.description && <p>{tag.description}</p>}
        {requirement && <p className="text-muted">{requirement}</p>}
        {consumeHint && <p className="text-accent">{consumeHint}</p>}
        <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} pts</span>
      </span>
    </span>
  );
}
