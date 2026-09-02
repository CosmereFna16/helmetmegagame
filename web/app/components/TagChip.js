import { formatCost, costColor, prerequisiteNames } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { turnsLeft, tagDuration } from "@/lib/turnFormat";
import ChipLabel from "./ChipLabel";
import ChipText from "./ChipText";
import HoverCard from "./HoverCard";

// Tag.expiresInto / Tag.removesInto as a {tag:…} token string for ChipText to
// resolve — the same machinery the description below already goes through,
// which is why this needs no catalog of its own and keeps working wherever
// TagChip renders. Entries are normalised to { oneOf: [...] } by
// db/lib/syncTags.js, so a bare slug is just a pick of one; several entries
// all land at once ("and"), while a multi-slug oneOf is a roll between them
// ("or").
function chainTokens(chain) {
  const entries = Array.isArray(chain) ? chain : null;
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
  const becomes = chainTokens(tag.expiresInto);
  // And what its treated form is — the aftermath a removal or Heal leaves.
  const treated = chainTokens(tag.removesInto);

  const panel = (
    <>
      <div className="flex items-start justify-between gap-2">
        <strong>
          {tag.name}
          {stack ? ` ×${stack}` : ""}
        </strong>
        {/* Group · category, top right — same info ChipLabel's border colour
            implies, spelled out for whoever can't rely on the colour alone. */}
        {(tag.group?.name || tag.category) && (
          <span className="text-muted whitespace-nowrap text-xs">
            {[tag.group?.name, tag.category].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      {/* inTooltip: this text renders inside this HoverCard's panel, so a
          {tag:…} in it can be a real, hoverable TagChip — pinning the panel
          makes it reachable. Nesting stops there: the nested chip renders its
          own description without the flag (see ChipText.js). */}
      {tag.description && <ChipText text={tag.description} as="p" inTooltip />}
      {consumeHint && <p className="text-accent">{consumeHint}</p>}
      {typeof onConsume === "function" && (
        <button type="button" className="btn-quiet" onClick={onConsume}>
          Consume
        </button>
      )}
      <dl className="tag-meta">
        {duration && <Meta label="Expires">{duration.label}</Meta>}
        {/* Reinforcement, not the only warning — every tag that gets worse
            says so in its own description too. This is the precise version.
            inTooltip: this text is rendered inside a HoverCard panel (this
            one), so a nested {tag:…} can safely become a real, hoverable
            TagChip now that pinning makes it reachable. */}
        {becomes && (
          <Meta label="Becomes">
            <ChipText text={becomes} inTooltip />
          </Meta>
        )}
        {treated && (
          <Meta label="Treated">
            <ChipText text={treated} inTooltip />
          </Meta>
        )}
        {/* Labelled, not bare: formatTagRequirement's leading "1t" is turns of
            WORK, which collided with the expiry countdown's own "1t" when both
            sat unlabelled in the same panel. Which work it is depends on the
            tag — on a wound the block is the cost to remove it, on a craftable
            it is the recipe to make one, and "Cure" read wrong over every brew
            and blade in the catalog. */}
        {requirement && (
          <Meta label={tag.craftable ? "Recipe" : "Cure"}>{requirement}</Meta>
        )}
        {/* Tag.inspectVisibility — whether another player sees this on the 🔍
            inspect embed. Only the affirmative renders; hidden is the default,
            so a "No" on most of the catalog would be noise. "Only while worn"
            is the concealable middle state, and it is worth spelling out: it
            is the difference between a dagger in a pocket and a drawn one. */}
        {tag.inspectVisibility && tag.inspectVisibility !== "HIDDEN" && (
          <Meta label="Seen by others">{tag.inspectVisibility === "WORN" ? "Only while worn" : "Yes"}</Meta>
        )}
        {/* The prerequisite gate (requiredTag, or the group's) — what marks
            role/faction kit as designed-for-you. Reads straight off the tag
            prop, no hooks, so the chip keeps rendering on the server; a
            caller that didn't fetch the relation simply gets no row. */}
        {prerequisiteNames(tag).length > 0 && (
          <Meta label="Requires">{prerequisiteNames(tag).join(", ")}</Meta>
        )}
        <Meta label="Cost">
          <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} {Math.abs(tag.pointCost ?? 0) === 1 ? "pt" : "pts"}</span>
        </Meta>
      </dl>
    </>
  );

  return (
    <HoverCard panel={panel}>
      <ChipLabel tag={tag} quantity={quantity} duration={duration} />
    </HoverCard>
  );
}
