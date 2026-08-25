import { formatCost, costColor, prerequisiteNames } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { turnsLeft, tagDuration } from "@/lib/turnFormat";
import ChipLabel from "./ChipLabel";
import ChipText from "./ChipText";
import HoverCard from "./HoverCard";

// Tag.expiresInto as a {tag:…} token string for ChipText to resolve — the
// same machinery the description below already goes through, which is why
// this needs no catalog of its own and keeps working wherever TagChip renders.
// Entries are normalised to { oneOf: [...] } by db/lib/syncTags.js, so a bare
// slug is just a pick of one; several entries all land at once ("and"), while
// a multi-slug oneOf is a roll between them ("or").
function expiresIntoTokens(expiresInto) {
  const entries = Array.isArray(expiresInto) ? expiresInto : null;
  if (!entries?.length) return null;
  return entries
    .map((entry) => (entry?.oneOf ?? []).map((slug) => `{tag:${slug}}`).join(" or "))
    .filter(Boolean)
    .join(" and ");
}

// One label/value row. Labels are muted and values carry --text, so the panel
// reads as answers rather than the flat block of grey <p>s it used to be.
function Meta({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

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
  // Minified "cost to add/remove this tag in play" — see Tag.requirement* in
  // schema.prisma. Null when unset, so the row is simply omitted.
  const requirement = formatTagRequirement(tag);

  // Pass the CharacterTag's expiresTurn (not the Tag's defaultDurationTurns) —
  // the clock started when it was granted. Null for a bare catalog reference,
  // which is what makes tagDuration fall back to the catalog wording.
  const left = turnsLeft(expiresTurn, currentTurn);
  const duration = tagDuration(left, tag.defaultDurationTurns);

  // What it turns into when that runs out, rather than simply going away.
  const becomes = expiresIntoTokens(tag.expiresInto);

  // The wrapper already carries tabIndex for the tooltip, so once it's
  // clickable it has to answer the keyboard too.
  const clickable = typeof onConsume === "function";

  const panel = (
    <>
      <strong>
        {tag.name}
        {stack ? ` ×${stack}` : ""}
      </strong>
      {/* ChipText, not RichText: a {tag:…} in here resolves to a plain label,
          since a chip nested inside a tooltip could never be hovered to reach
          its own tooltip. */}
      {tag.description && <ChipText text={tag.description} as="p" />}
      {consumeHint && <p className="text-accent">{consumeHint}</p>}
      <dl className="tag-meta">
        {duration && <Meta label="Expires">{duration.label}</Meta>}
        {/* Reinforcement, not the only warning — every tag that gets worse
            says so in its own description too. This is the precise version. */}
        {becomes && (
          <Meta label="Becomes">
            <ChipText text={becomes} />
          </Meta>
        )}
        {/* "Cure", not a bare string: formatTagRequirement's leading "1t" is
            turns of WORK to remove the tag, which collided with the expiry
            countdown's own "1t" when both sat unlabelled in the same panel. */}
        {requirement && <Meta label="Cure">{requirement}</Meta>}
        {/* Tag.visibleOnInspect — whether another player sees this on the 🔍
            inspect embed. Only the affirmative renders; hidden is the default,
            so a "No" on most of the catalog would be noise. */}
        {tag.visibleOnInspect && <Meta label="Seen by others">Yes</Meta>}
        {/* The prerequisite gate (requiredTag, or the group's) — what marks
            role/faction kit as designed-for-you. Reads straight off the tag
            prop, no hooks, so the chip keeps rendering on the server; a
            caller that didn't fetch the relation simply gets no row. */}
        {prerequisiteNames(tag).length > 0 && (
          <Meta label="Requires">{prerequisiteNames(tag).join(", ")}</Meta>
        )}
        <Meta label="Cost">
          <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} pts</span>
        </Meta>
      </dl>
    </>
  );

  return (
    <HoverCard
      panel={panel}
      className={clickable ? "cursor-pointer" : ""}
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
      <ChipLabel tag={tag} quantity={quantity} duration={duration} />
    </HoverCard>
  );
}
