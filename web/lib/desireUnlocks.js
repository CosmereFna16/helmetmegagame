// What a tag OPENS: the Desires a character becomes able to take by holding
// it. The reverse of the gate DesireTemplate declares — `requires.anyTags` in
// docs/desires.yaml is written from the Desire's side, and this reads it from
// the tag's.
//
// Pure — no prisma, no I/O — because PointBuy is a client component and an
// import that reached @lifeweb/db from one would drag the whole data layer
// into the browser (a failure this repo has already had once). The Prisma
// select that feeds it lives in web/lib/referenceData.js, which is
// server-only; nothing here may import that file.

import { splitTokens } from "@/app/components/richTokens";
//
// ONLY THE UNLOCK DIRECTION. `requiresNotTags` (a tag that forbids a Desire)
// and Tag.desireLocks (the Addiction/Restriction clauses) are the locking
// half and are deliberately absent: a tooltip that mixed "this opens" with
// "this shuts" would need the reader to work out which was which on every
// line.

// The Desire's tier doubles as the Tag Point award, so the number beside a row
// is what fulfilling it pays (docs/desires.yaml header).

// 23 Desire names carry a {tag:…} inline reference — "Eat {tag:human-flesh}",
// "Craft {tag:plate-armor}". Every other surface resolves those into a real
// chip through ChipText, which reads the tag catalog from a CONTEXT — and a
// hook is the one thing this cannot use, because TagChip renders on the server
// (and PointBuy's row is a <button>, where a chip would be a button inside a
// button anyway).
//
// So the token is flattened to its display name, reconstructed by title-casing
// the slug. That is a reconstruction rather than a lookup, and it is worth
// being honest about: it was checked against the live catalog and all 23
// tokens currently in Desire names resolve exactly ({tag:apex-form} -> "Apex
// Form", {tag:ravenheart-red} -> "Ravenheart Red"). A future tag whose display
// name is not its title-cased slug would read slightly wrong here — a cosmetic
// miss in one tooltip line, never a wrong gate or a leak.
function titleCase(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function plainDesireName(name) {
  return splitTokens(String(name ?? ""))
    .map((part) => (part.kind === "tag" ? titleCase(part.payload) : (part.text ?? part.raw)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// Named co-requirements, for a Desire that needs this tag AND others. Resolved
// against what the viewer may see: a hidden co-requirement is worth admitting
// to without naming, since the row is already visible and pretending it has no
// condition would be the actual lie.
function withTagsNote(others, visibleTagSlugs) {
  if (!others.length) return null;
  const known = visibleTagSlugs
    ? others.filter((t) => visibleTagSlugs.has(t.slug))
    : others;
  if (known.length !== others.length) {
    return known.length ? `with ${known.map((t) => t.name).join(" + ")} and another tag` : "with another tag";
  }
  return `with ${known.map((t) => t.name).join(" + ")}`;
}

// A Desire whose gate also names roles opens two different ways depending on
// one flag, and getting it backwards would make the list lie in both
// directions at once:
//
//   requiresAnyOf = false (the DEFAULT)  tag AND role  -> the tag alone is not
//                                        enough, so the row is marked.
//   requiresAnyOf = true  (`combine: or`) tag OR role  -> the roles are an
//                                        ALTERNATIVE door. The tag alone opens
//                                        it, so there is nothing to mark.
//
// The second case is the common one and the whole reason `combine: or` exists
// (docs/desires.yaml header: so a purchasable gating tag is not dead weight to
// anyone outside the role). Marking those would tell a player they need a role
// they do not need.
function rolesNote(template) {
  const needsRole = (template.requiresAnyRoleSlugs?.length ?? 0) > 0 && !template.requiresAnyOf;
  return needsRole ? "+ role" : null;
}

// `tag` is a row selected with DESIRE_UNLOCK_SELECT. `visibleTagSlugs` is an
// optional Set used only to keep a co-requirement note from naming a tag the
// viewer cannot see; the ROWS themselves need no filtering, because a tag's
// unlocks are exactly as visible as the tag is (web/lib/referenceData.js
// withholds a group-gated tag wholesale, Demoness included).
//
// Returns [{ slug, name, tier, note }], best-paying first.
export function desireUnlocksFor(tag, { visibleTagSlugs = null } = {}) {
  const rows = new Map();

  for (const template of tag?.desireRequiredBy ?? []) {
    rows.set(template.slug, {
      slug: template.slug,
      name: plainDesireName(template.name),
      tier: template.tier,
      note: rolesNote(template),
    });
  }

  // An `allTags` Desire wants every tag in its list, so the note names the
  // rest. Second, and overwriting: if a template somehow sits in both
  // relations, the harder requirement is the true one to show.
  for (const template of tag?.desireAllRequiredBy ?? []) {
    const others = (template.requiresAllTags ?? []).filter((t) => t.slug !== tag.slug);
    rows.set(template.slug, {
      slug: template.slug,
      name: plainDesireName(template.name),
      tier: template.tier,
      note: withTagsNote(others, visibleTagSlugs),
    });
  }

  // Tier descending: the biggest prize is the reason to buy the tag, so it
  // reads first. Name breaks the tie so the order never wobbles between two
  // renders of the same list.
  return [...rows.values()].sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
}
