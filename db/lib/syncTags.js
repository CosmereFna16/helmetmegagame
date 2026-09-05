// docs/tags.yaml + docs/taggroups.yaml -> DB, called by db/scripts/sync/sync-tags.js
// (manual `npm run db:sync-tags`) and wipeGameData's "Restart Game" flow
// (web/app/(app)/gm/dev/actions.js) — see docs/systemdocs/TAGS.md.
// Upsert-only and never deletes. Six passes: tags/groups reference each
// other by slug, and some fields can only resolve once every Tag row
// exists. Each pass only writes when something actually changed.
const { settleCarry } = require("./carry");
const fs = require("node:fs");
const yaml = require("js-yaml");
const { docsPath, repoPath } = require("./repoPaths");
const { CORPSE_GROUP_SLUG } = require("./constants");
const { PAPER_GROUP_SLUG } = require("./paper");
const {
  normalizeRequirementItems,
  validateRequirementItems,
  normalizeLaborBonus,
  validateLaborBonus,
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
  normalizePlacement,
  validatePlacement,
} = require("./tagShapes");
const { normalizeDesireLocks, validateDesireLocks } = require("./desireShapes");
const { desireFamilyKeys } = require("./desireFamilies");
const { entriesOf } = require("./yamlEntries");
const { NAME_LIMITS } = require("./characterName");

// `equipSlot:` in docs/tags.yaml -> Tag.equipSlot. HEAD and BODY take a layer
// 1-4; SHIELD refuses one, because there is only ever one shield.
const EQUIP_SLOTS = new Set(["HEAD", "BODY", "SHIELD"]);
const LAYERED_SLOTS = new Set(["HEAD", "BODY"]);
const MAX_EQUIP_LAYER = 4;

// Where generate-helms.js writes the concealed-identity avatars. Null, or a
// directory that isn't there, means "cannot check" rather than "invalid" —
// see repoPaths.js#repoPath.
const HELM_DIR = repoPath("web/public/assets/helms");

// `visible:` in docs/tags.yaml -> Tag.inspectVisibility, a real enum rather
// than a truthy string.
const VISIBILITY_BY_YAML = new Map([
  [true, "ALWAYS"],
  [false, "HIDDEN"],
  ["worn", "WORN"],
]);

// `catalog:` in docs/tags.yaml -> Tag.catalogVisibility. Required on every
// tag, like pointCost: who may see a tag in the /documents Tag Catalog is a
// deliberate call per tag, and a default here would let a spoiler ship by
// omission. secret = cave/antagonist content, hidden from everyone (GMs use
// /gm/dev/tags); gm = GMs, plus players whose character relates to it; all =
// fully public. Read by web/lib/tagCatalog.js.
const CATALOG_BY_YAML = new Map([
  ["secret", "SECRET"],
  ["gm", "GM"],
  ["all", "ALL"],
]);

// Categories whose tags may carry their category as a slug prefix, because a
// hidden power's name ("Heal", "Seductive") is generic enough to collide with
// a general tag. Everywhere else the slug is exactly the slugified name.
const HIDDEN_CATEGORIES = new Set(["demoness"]);

// JSON.stringify with object keys sorted recursively, array order kept.
// Only for the change-detection compare below — jsonb hands keys back in its
// own order, so a naive stringify of a stored object never matches the
// authored one and the row updates on every run.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// The one slug rule, applied to Tag.name. Lowercase, punctuation dropped,
// whitespace and colons to hyphens: "Old Ways (Bacchus)" -> old-ways-bacchus,
// "True Form: Serpent" -> true-form-serpent.
function slugifyName(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s:-]/g, "")
    .replace(/[\s:]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// A consumesInto entry is a bare slug, an object with a condition and/or an
// expiry override, or a random pick between alternatives ({ oneOf: [...] }).
// Every shape normalises to one quad here so validation and the write path
// only ever handle one shape.
function normalizeConsumesInto(entries) {
  return (entries ?? []).map((entry) => {
    if (typeof entry === "string") {
      return { slug: entry, unlessTags: [], durationTurns: null, oneOf: null };
    }
    if (Array.isArray(entry?.oneOf)) {
      if (entry.oneOf.length < 2) {
        throw new Error(`docs/tags.yaml: a consumesInto { oneOf: [...] } entry needs at least two alternatives`);
      }
      return { slug: entry.oneOf[0], unlessTags: [], durationTurns: null, oneOf: [...entry.oneOf] };
    }
    if (!entry?.slug) {
      throw new Error(`docs/tags.yaml: a consumesInto entry is missing its "slug"`);
    }
    const durationTurns = entry.durationTurns ?? null;
    if (durationTurns != null && !(Number.isInteger(durationTurns) && durationTurns > 0)) {
      throw new Error(
        `docs/tags.yaml: consumesInto entry "${entry.slug}" has a durationTurns that is not a positive whole number`,
      );
    }
    return { slug: entry.slug, unlessTags: entry.unlessTags ?? [], durationTurns, oneOf: null };
  });
}

// Splits the normalised list back into the four columns it's stored in.
// The three side columns stay null unless a tag actually uses that shape.
function consumesIntoScalars(entries) {
  const normalized = normalizeConsumesInto(entries);
  const unless = {};
  const durations = {};
  let anyOneOf = false;
  for (const { slug, unlessTags, durationTurns } of normalized) {
    if (unlessTags.length) unless[slug] = unlessTags;
    if (durationTurns != null) durations[slug] = durationTurns;
  }
  const oneOfList = normalized.map((e) => e.oneOf ?? null);
  if (oneOfList.some((v) => v !== null)) anyOneOf = true;
  return {
    consumesInto: normalized.map((e) => e.slug),
    consumesIntoUnless: Object.keys(unless).length ? unless : null,
    consumesIntoDurations: Object.keys(durations).length ? durations : null,
    consumesIntoOneOf: anyOneOf ? oneOfList : null,
  };
}

// normalizeExpiresInto and its rules live in db/lib/tagShapes.js, shared
// with the GM tag form's expiry picker.

// docsPath() is null only when docs/ cannot be found at all — fatal here,
// since a missing master would read as "everything was deleted" and prune
// the lot. See db/lib/repoPaths.js.
// A wax stamp's description, composed rather than authored, so the boilerplate
// is written once and cannot drift across fifteen entries. Returns null for
// everything that is not a stamp. See docs/systemdocs/PAPERWORK.md.
//
// Two sentences: what the thing is, then what is cut into it. An office stamp
// names its seat; a courtier's private seal does not, because it belongs to
// whoever is holding it.
//
// The Merchant's is the deliberate gap — `sealOffice` with no `sealMark`. His
// mark bears his own initials and is written at character creation
// (web/app/(app)/character/createActions.js), so until a Merchant exists the
// description honestly says nobody has pressed it yet.
// Whose mark is this — the file's, or the game's? A stamp that names an office
// but carries no mark is one the game fills in at runtime. There is exactly one
// today (the Merchant's) and the rule is written rather than the slug, so a
// second one needs no code.
function gameWrittenSeal(entry) {
  return Boolean(entry.sealOffice?.trim()) && !entry.sealMark?.trim();
}

function sealDescription(entry) {
  const mark = entry.sealMark?.trim();
  const office = entry.sealOffice?.trim();
  if (!mark && !office) return null;
  const opening = office ? `The ${office}'s wax stamp.` : "A wax stamp for sealing letters.";
  return mark ? `${opening} ${mark} ‡` : `${opening} Nobody has pressed it yet. ‡`;
}

function requireDocsPath(...segments) {
  const p = docsPath(...segments);
  if (!p) throw new Error(`Cannot find docs/${segments.join("/")} — see db/lib/repoPaths.js`);
  return p;
}

function loadDoc() {
  const yamlPath = requireDocsPath("tags.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

function loadGroupsDoc() {
  const yamlPath = requireDocsPath("taggroups.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// Every role slug in docs/roles.yaml, for validating `excludedRoles:`. Read
// from the FILE rather than the Role table so a typo fails the same way in a
// fresh database as in a seeded one — db:sync runs tags before roles, so the
// table may not hold the seat yet.
function roleSlugsFromYaml() {
  const doc = yaml.load(fs.readFileSync(requireDocsPath("roles.yaml"), "utf8"));
  const slugs = new Set();
  for (const zone of entriesOf(doc?.zones, "slug")) {
    for (const faction of entriesOf(zone?.factions, "slug")) {
      for (const role of entriesOf(faction?.roles, "slug")) {
        if (role.slug) slugs.add(role.slug);
      }
    }
  }
  return slugs;
}

async function syncTagsFromYaml(prisma) {
  const doc = loadDoc();
  const groupsDoc = loadGroupsDoc();
  // Category slugs map to display names — that's what the UI renders raw,
  // so the DB should never hold the lowercase slug.
  const categoryNameBySlug = new Map(entriesOf(doc?.categories, "slug").map((c) => [c.slug, c.name]));
  const groupEntries = entriesOf(groupsDoc?.groups, "slug");
  const tagEntries = entriesOf(doc?.tags, "slug");

  for (const g of groupEntries) {
    if (!categoryNameBySlug.has(g.category)) {
      throw new Error(`docs/taggroups.yaml: group "${g.slug}" has unknown category "${g.category}"`);
    }
  }
  const allTagSlugs = new Set(tagEntries.map((t) => t.slug));
  // For requirement.items: the display labels are denormalized into the stored
  // Json (see db/lib/tagShapes.js), so both maps are needed at write time as
  // well as at validation time. Built from the YAML, not the DB — every slug a
  // recipe may name has to be in these files anyway.
  const allGroupSlugs = new Set(groupEntries.map((g) => g.slug));
  const tagNameBySlug = new Map(tagEntries.map((t) => [t.slug, t.name]));
  const groupNameBySlug = new Map(groupEntries.map((g) => [g.slug, g.name]));
  const allRoleSlugs = roleSlugsFromYaml();
  for (const t of tagEntries) {
    if (!categoryNameBySlug.has(t.category)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has unknown category "${t.category}"`);
    }
    // A slug is always its name, slugified — so anyone reading a slug in code
    // or in a Desire's requires knows which tag it is. Two exceptions: a
    // hidden category (demoness), where a bare name like "Heal" or
    // "Seductive" collides with a general tag and the category leads instead;
    // and an entry marked `keepSlug: true`, for a tag RENAMED in play whose
    // old slug is load-bearing (desires, code, live CharacterTag references)
    // — the entries' own comments say why, and a keepSlug on a slug that
    // already matches its name throws, so the flag can never go stale.
    const wantSlug = slugifyName(t.name);
    const prefixed = `${t.category}-${wantSlug}`;
    const allowed = HIDDEN_CATEGORIES.has(t.category) ? [wantSlug, prefixed] : [wantSlug];
    if (t.keepSlug === true) {
      if (allowed.includes(t.slug)) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets keepSlug but its slug already matches its name — drop the flag`,
        );
      }
    } else if (!allowed.includes(t.slug)) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" is named "${t.name}", so its slug should be "${allowed.join('" or "')}" — rename the slug with the name, fix the name, or mark the rename deliberate with keepSlug: true`,
      );
    }
    // concealsIdentity requires equippable — a typo guard, not a rule.
    if (t.concealsIdentity && !t.equippable) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets concealsIdentity but not equippable — it could never be equipped, so it could never conceal anything`,
      );
    }
    // forcesName fixes the character's presented name (Tag.forcedName). It has
    // to fit a first name, since it stands in for one, and a tag can't both
    // hide who you are and dictate it.
    if (t.forcesName !== undefined) {
      if (typeof t.forcesName !== "string" || !t.forcesName.trim()) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" sets forcesName but it is empty — give the name the character is forced to wear`);
      }
      if (t.forcesName.trim().length > NAME_LIMITS.firstName) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets forcesName "${t.forcesName}" — longer than the ${NAME_LIMITS.firstName}-character first-name budget`,
        );
      }
      if (t.concealsIdentity) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" sets both forcesName and concealsIdentity — a tag can't hide who you are and dictate it`);
      }
    }
    // A concealing tag has to have a face to show. Checking the file is really
    // there matters more than it looks: a typo in concealSprite would
    // otherwise stay invisible until somebody equipped the thing in play and
    // Discord served a broken image, which is a miserable way to find out.
    if (t.concealsIdentity && !t.concealSprite) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets concealsIdentity but no concealSprite — concealing gear is what the room sees instead of a face, so it needs one`,
      );
    }
    if (t.concealSprite !== undefined) {
      if (typeof t.concealSprite !== "string" || !t.concealSprite.trim()) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" sets concealSprite but it is empty — name a sprite in web/public/assets/helms`);
      }
      if (!t.concealsIdentity) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets concealSprite but not concealsIdentity — nothing would ever show it`,
        );
      }
      if (HELM_DIR && fs.existsSync(HELM_DIR) && !fs.existsSync(`${HELM_DIR}/${t.concealSprite.trim()}.webp`)) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets concealSprite "${t.concealSprite}" but web/public/assets/helms/${t.concealSprite}.webp does not exist — add the source sprite and run \`npm run assets:helms --workspace=web\``,
        );
      }
    }
    // forcesConceal is a stricter concealsIdentity, never a substitute for it:
    // forcing a concealment the catalog does not grant is a contradiction.
    if (t.forcesConceal && !t.concealsIdentity) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets forcesConceal but not concealsIdentity — it can't take away a choice it never gave`,
      );
    }
    // equipSlot/equipLayer: the pair that stops two helmets going on one head.
    if (t.equipSlot !== undefined) {
      if (!EQUIP_SLOTS.has(t.equipSlot)) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" has equipSlot: ${JSON.stringify(t.equipSlot)} — say ${[...EQUIP_SLOTS].join(", ")}`,
        );
      }
      if (!t.equippable) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets equipSlot but not equippable — a slot only means anything once something can occupy it`,
        );
      }
      if (LAYERED_SLOTS.has(t.equipSlot)) {
        if (!Number.isInteger(t.equipLayer) || t.equipLayer < 1 || t.equipLayer > MAX_EQUIP_LAYER) {
          throw new Error(
            `docs/tags.yaml: tag "${t.slug}" is equipSlot ${t.equipSlot}, so it needs equipLayer 1-${MAX_EQUIP_LAYER} — 1 against the skin, ${MAX_EQUIP_LAYER} outermost`,
          );
        }
      } else if (t.equipLayer !== undefined) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" is equipSlot ${t.equipSlot} and sets equipLayer — that slot holds exactly one thing, so there is nothing to layer`,
        );
      }
    } else if (t.equipLayer !== undefined) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets equipLayer but no equipSlot — a layer of what?`);
    }
    // `catalog` must be explicit on every tag — who may see it in the Tag
    // Catalog is a deliberate call, and a default would let a cave or
    // antagonist spoiler ship by omission.
    if (!CATALOG_BY_YAML.has(t.catalog)) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" has catalog: ${JSON.stringify(t.catalog)} — say secret (cave/antagonist, nobody sees it), gm (GMs, plus players whose character relates to it), or all (fully public)`,
      );
    }
    // `visible` is three-state: true, false, or "worn".
    if (!VISIBILITY_BY_YAML.has(t.visible ?? false)) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" has visible: ${JSON.stringify(t.visible)} — say true, false, or worn`,
      );
    }
    // Same pairing guard as concealsIdentity: visible: worn needs equippable.
    if (t.visible === "worn" && !t.equippable) {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" sets visible: worn but not equippable — it could never be equipped, so it could never be seen`,
      );
    }
    // `tradeable` must be explicit for items/assets — silence would default
    // to unmovable and nobody would notice until a player couldn't hand
    // over what they made.
    if ((t.category === "items" || t.category === "assets") && typeof t.tradeable !== "boolean") {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" is in category "${t.category}" but does not set tradeable — say true or false explicitly, since it decides whether the tag can be handed over or looted off a body`,
      );
    }
    // `weight` must be explicit for a TRADEABLE item, for the same reason
    // `tradeable` must: silence would default to weightless and a new sword
    // would cost nobody anything to carry. Two exemptions, both because the
    // tag is not cargo (docs/systemdocs/CARRY.md §1): Assets carry themselves
    // or do not move at all, and an untradeable item is part of you — nobody
    // hauls the Quickened Nerve Braid, it is grafted into their neck.
    if (t.category === "items" && t.tradeable && typeof t.weight !== "number") {
      throw new Error(
        `docs/tags.yaml: tag "${t.slug}" is an item but sets no weight — give it a pounds figure off the band table in the header of that file`,
      );
    }
    if (typeof t.weight === "number" && !(t.weight >= 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has a negative weight`);
    }

    // consumesInto is validated here, against slugs already known from this
    // document, so a typo fails cleanly instead of half-applying.
    for (const { slug, unlessTags, oneOf } of normalizeConsumesInto(t.consumesInto)) {
      if (!allTagSlugs.has(slug)) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" consumesInto references unknown tag "${slug}"`);
      }
      for (const blocker of unlessTags) {
        if (!allTagSlugs.has(blocker)) {
          throw new Error(
            `docs/tags.yaml: tag "${t.slug}" consumesInto "${slug}" has unknown unlessTags entry "${blocker}"`,
          );
        }
      }
      for (const alt of oneOf ?? []) {
        if (!allTagSlugs.has(alt)) {
          throw new Error(`docs/tags.yaml: tag "${t.slug}" consumesInto oneOf references unknown tag "${alt}"`);
        }
      }
    }
    // carryBonus moves both carry caps, signed: +4 for a Cart, -0.1 for Frail
    // (docs/systemdocs/CARRY.md §1). Zero is rejected rather than treated as
    // "no bonus" — writing it means somebody meant something by it, and the
    // honest way to say "none" is to leave the key out.
    if (t.carryBonus != null && !(typeof t.carryBonus === "number" && Number.isFinite(t.carryBonus) && t.carryBonus !== 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has a carryBonus that is not a non-zero number`);
    }
    // sellable/sellablePrice must travel together.
    if (t.sellable && !(Number.isInteger(t.sellablePrice) && t.sellablePrice > 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" is sellable but has no positive sellablePrice`);
    }
    if (t.sellablePrice != null && !t.sellable) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets sellablePrice without sellable: true`);
    }
    // Only a ware the station actually stocks can arrive in a crate at all, so
    // sealing something the Depot does not sell is a typo rather than a rule.
    if (t.sealedShipping && t.depotPrice == null) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets sealedShipping but has no depotPrice — the Depot does not stock it, so it can never ship`);
    }
    // depotPrice is the buy side; carrying a price is what puts it on the shelf.
    if (t.depotPrice != null && !(Number.isInteger(t.depotPrice) && t.depotPrice > 0)) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" has a depotPrice that is not a positive integer`);
    }
    // Warning only, not an error — see docs/systemdocs/DEPOT.md §3.
    if (t.depotPrice != null && t.sellablePrice != null && t.sellablePrice >= t.depotPrice) {
      console.warn(
        `docs/tags.yaml: tag "${t.slug}" sells back for ${t.sellablePrice} ⬢ but costs ${t.depotPrice} ⬢ at the Depot — buying and selling it in a loop prints Resources`,
      );
    }
    // A wax stamp is declared BY its mark: `sealMark` is the line the wax
    // carries ("Three cups, stacked."), and the sync composes the whole
    // description around it so the boilerplate is written once. Authoring a
    // description beside one is therefore an error rather than an override —
    // silently ignoring it would leave the file claiming something the game
    // does not say. See docs/systemdocs/PAPERWORK.md.
    if (t.sealMark !== undefined) {
      if (typeof t.sealMark !== "string" || !t.sealMark.trim()) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" sets sealMark but it is empty — give the line the wax carries`);
      }
      if (t.description != null) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets both sealMark and description — the sync composes a stamp's description from sealMark and sealOffice`,
        );
      }
    }
    // A book is declared BY its text: `bookText` is what is written inside it,
    // and the sync files it on Tag.paperText with paperKind BOOK, exactly where
    // a written sheet keeps its own words. That is the whole point — the text
    // never touches `description`, which every signed-in browser receives.
    // Authoring a description beside one is an error for the same reason it is
    // on a stamp: the file would claim something the game never says.
    if (t.bookText !== undefined) {
      if (typeof t.bookText !== "string" || !t.bookText.trim()) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" sets bookText but it is empty — give the book something to say`);
      }
      if (t.description != null) {
        throw new Error(
          `docs/tags.yaml: tag "${t.slug}" sets both bookText and description — a book's description is composed per reader from its text`,
        );
      }
      if (t.group !== PAPER_GROUP_SLUG) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" sets bookText but is not in group ${PAPER_GROUP_SLUG}`);
      }
    }

    // `sealOffice` names the seat a stamp belongs to, and only changes the
    // sentence the mark is set into. The Merchant's is the one stamp with an
    // office and no mark: his bears his own initials, written at character
    // creation, so an empty sealMark here is expected rather than a mistake.
    if (t.sealOffice !== undefined && (typeof t.sealOffice !== "string" || !t.sealOffice.trim())) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets sealOffice but it is empty`);
    }
    if (t.sealOffice !== undefined && t.description != null) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets both sealOffice and description`);
    }

    // expiresInto/removesInto: shared shape and rules in db/lib/tagShapes.js.
    validateExpiresInto(normalizeExpiresInto(t.expiresInto), {
      selfSlug: t.slug,
      knownSlugs: allTagSlugs,
      durationTurns: t.durationTurns,
    });
    validateRemovesInto(normalizeRemovesInto(t.removesInto), {
      selfSlug: t.slug,
      knownSlugs: allTagSlugs,
    });
    // requirement.items — the enforced, non-consuming ingredient check.
    validateRequirementItems(
      normalizeRequirementItems(t.requirement?.items, { tagNameBySlug, groupNameBySlug }),
      {
        selfSlug: t.slug,
        tagSlugs: allTagSlugs,
        groupSlugs: allGroupSlugs,
        craftable: t.craftable ?? false,
      },
    );
    // laborBonus — the tools table (docs/systemdocs/LABORING.md). A bonus that
    // only pays while equipped, on a tag nothing can equip, is dead weight
    // nobody would notice; this is the one place that catches it.
    validateLaborBonus(normalizeLaborBonus(t.laborBonus), {
      selfSlug: t.slug,
      tagSlugs: allTagSlugs,
      equippable: t.equippable ?? false,
    });
    // placement — the building system's catalog half (db/lib/structures.js is
    // the read side). Validated up front like requirement.items: craftable
    // only, never tradeable/stackable/equippable/carryBonus, and provides
    // must name real tags, so a typo fails before any write.
    validatePlacement(normalizePlacement(t.placement), {
      slug: t.slug,
      tag: t,
      knownSlugs: allTagSlugs,
    });
    // desires.locks — validated via the shared desireShapes rules. A missing
    // docs/desires.yaml yields an empty family set, so this only throws when
    // a tag actually names one.
    validateDesireLocks(normalizeDesireLocks(t.desires?.locks), {
      slug: t.slug,
      families: desireFamilyKeys(),
    });
    // excludedRoles — every entry has to be a real seat, or the gate quietly
    // stops applying to the role somebody meant to shut out.
    for (const roleSlug of t.excludedRoles ?? []) {
      if (!allRoleSlugs.has(roleSlug)) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" excludedRoles references unknown role "${roleSlug}"`);
      }
    }
    // onlyRoles — the whitelist half, same validation. A typo here would
    // silently close the tag to EVERY seat rather than open it to one, which
    // is the worse failure of the two.
    for (const roleSlug of t.onlyRoles ?? []) {
      if (!allRoleSlugs.has(roleSlug)) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" onlyRoles references unknown role "${roleSlug}"`);
      }
    }
    if ((t.onlyRoles ?? []).length > 0 && (t.excludedRoles ?? []).length > 0) {
      throw new Error(`docs/tags.yaml: tag "${t.slug}" sets both onlyRoles and excludedRoles; pick one`);
    }
    // conflictsWith — a tag cannot conflict with itself.
    for (const other of t.conflictsWith ?? []) {
      if (other === t.slug) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" lists itself in conflictsWith`);
      }
      if (!allTagSlugs.has(other)) {
        throw new Error(`docs/tags.yaml: tag "${t.slug}" conflictsWith references unknown tag "${other}"`);
      }
    }
  }

  let groupsCreated = 0;
  let groupsUpdated = 0;
  let tagsCreated = 0;
  let tagsUpdated = 0;
  let linksUpdated = 0;

  // Pass 1: TagGroup scalars.
  const groupIdBySlug = new Map();
  for (const entry of groupEntries) {
    const color = entry.color ?? null;
    const categoryName = categoryNameBySlug.get(entry.category);
    let group = await prisma.tagGroup.findUnique({ where: { slug: entry.slug } });
    if (!group) {
      group = await prisma.tagGroup.create({
        data: { slug: entry.slug, name: entry.name, category: categoryName, color },
      });
      groupsCreated += 1;
    } else {
      const needsUpdate = group.name !== entry.name || group.category !== categoryName || group.color !== color;
      if (needsUpdate) {
        group = await prisma.tagGroup.update({
          where: { id: group.id },
          data: { name: entry.name, category: categoryName, color },
        });
        groupsUpdated += 1;
      }
    }
    groupIdBySlug.set(entry.slug, group.id);
  }

  // Pass 2: Tag scalars + groupId.
  const tagIdBySlug = new Map();
  for (const entry of tagEntries) {
    const groupId = entry.group ? (groupIdBySlug.get(entry.group) ?? null) : null;
    if (entry.group && !groupId) {
      throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown group "${entry.group}"`);
    }
    const scalars = {
      name: entry.name,
      // A stamp whose mark the GAME writes rather than the YAML — the
      // Merchant's, which bears his own initials — keeps both of these fields
      // out of `scalars` entirely, so the diff never compares them and the
      // upsert never touches them. Without that, the next db:sync-tags would
      // quietly rub his initials back off.
      ...(gameWrittenSeal(entry)
        ? {}
        : { description: sealDescription(entry) ?? entry.description ?? null, sealMark: entry.sealMark?.trim() ?? null }),
      // An authored book. `description` above is already null for one (the
      // validation refuses both), and paperDescription composes what a given
      // reader sees out of these two columns instead.
      paperKind: entry.bookText?.trim() ? "BOOK" : null,
      paperText: entry.bookText?.trim() ?? null,
      category: categoryNameBySlug.get(entry.category),
      pointCost: entry.pointCost ?? 0,
      inspectVisibility: VISIBILITY_BY_YAML.get(entry.visible ?? false),
      catalogVisibility: CATALOG_BY_YAML.get(entry.catalog),
      // At most one exclusive tag per character (the Beliefs); rule lives in
      // web/lib/characterCreation.js#exclusiveConflict.
      exclusive: entry.exclusive ?? false,
      tradeable: entry.tradeable ?? false,
      weightLbs: entry.weight ?? null,
      carryBonus: entry.carryBonus ?? null,
      equippable: entry.equippable ?? false,
      concealsIdentity: entry.concealsIdentity ?? false,
      forcesConceal: entry.forcesConceal ?? false,
      concealSprite: entry.concealSprite?.trim() ?? null,
      equipSlot: entry.equipSlot ?? null,
      equipLayer: entry.equipLayer ?? null,
      forcedName: entry.forcesName?.trim() ?? null,
      stackable: entry.stackable ?? false,
      purchasable: entry.purchasable ?? false,
      purchasableAfterStart: entry.purchasableAfterStart ?? true,
      excludedRoleSlugs: entry.excludedRoles ?? [],
      onlyRoleSlugs: entry.onlyRoles ?? [],
      sellable: entry.sellable ?? false,
      sellablePrice: entry.sellablePrice ?? null,
      depotPrice: entry.depotPrice ?? null,
      sealedShipping: entry.sealedShipping ?? false,
      defaultDurationTurns: entry.durationTurns ?? null,
      removable: entry.removable ?? false,
      craftable: entry.craftable ?? false,
      healable: entry.healable ?? false,
      teachable: entry.teachable ?? false,
      psychological: entry.psychological ?? false,
      consumable: entry.consumable ?? false,
      consumesIntoResources: entry.consumesIntoResources ?? null,
      expiresInto: normalizeExpiresInto(entry.expiresInto),
      removesInto: normalizeRemovesInto(entry.removesInto),
      requirementTurns: entry.requirement?.turnsCost ?? null,
      requirementResources: entry.requirement?.resourceCost ?? null,
      requirementGambit: entry.requirement?.gambit ?? false,
      requirementPerTurn: entry.requirement?.perTurn ?? null,
      requirementItems: normalizeRequirementItems(entry.requirement?.items, { tagNameBySlug, groupNameBySlug }),
      laborBonus: normalizeLaborBonus(entry.laborBonus),
      placement: normalizePlacement(entry.placement),
      // Membership of the corpse group IS being a corpse, so the flag is
      // derived here rather than hand-written on three entries that could
      // drift from it. Always FRESH: a monster corpse never rots, and the
      // per-character ones that do are `custom` rows this sync never sees.
      corpseKind: entry.group === CORPSE_GROUP_SLUG ? "FRESH" : null,
      ...consumesIntoScalars(entry.consumesInto),
      desireLocks: normalizeDesireLocks(entry.desires?.locks),
      groupId,
    };

    let tag = await prisma.tag.findUnique({ where: { slug: entry.slug } });
    if (!tag) {
      tag = await prisma.tag.create({
        data: {
          slug: entry.slug,
          ...scalars,
          // A game-written stamp is left out of `scalars` so a re-sync cannot
          // rub its mark off — but a brand-new row still needs SOMETHING to
          // say, so the placeholder is seeded here and only here.
          ...(gameWrittenSeal(entry) ? { description: sealDescription(entry) } : {}),
        },
      });
      tagsCreated += 1;
    } else {
      // Arrays/Json fields compare by value. ARRAY order stays significant —
      // a repeated slug means "grant two", so those are sequences not sets —
      // but OBJECT keys are sorted before comparing, because Postgres jsonb
      // does not preserve key order: a straight JSON.stringify made every
      // desireLocks/placement carrier read as changed on every run, so seven
      // rows "updated" forever and the diff discipline meant nothing.
      const needsUpdate = Object.entries(scalars).some(([key, value]) => {
        if (Array.isArray(value) || (value !== null && typeof value === "object")) {
          return stableStringify(value) !== stableStringify(tag[key]);
        }
        return tag[key] !== value;
      });
      if (needsUpdate) {
        tag = await prisma.tag.update({ where: { id: tag.id }, data: scalars });
        tagsUpdated += 1;
      }
    }
    tagIdBySlug.set(entry.slug, tag.id);
  }

  // Pass 3: parentTag / requiredTag references.
  for (const entry of tagEntries) {
    const tagId = tagIdBySlug.get(entry.slug);
    const parentTagId = entry.parentTag ? (tagIdBySlug.get(entry.parentTag) ?? null) : null;
    const requiredTagId = entry.requiredTag ? (tagIdBySlug.get(entry.requiredTag) ?? null) : null;
    if (entry.parentTag && !parentTagId) {
      throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown parentTag "${entry.parentTag}"`);
    }
    if (entry.requiredTag && !requiredTagId) {
      throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown requiredTag "${entry.requiredTag}"`);
    }

    const current = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { parentTagId: true, requiredTagId: true },
    });
    if (current.parentTagId !== parentTagId || current.requiredTagId !== requiredTagId) {
      await prisma.tag.update({ where: { id: tagId }, data: { parentTagId, requiredTagId } });
      linksUpdated += 1;
    }
  }

  // Pass 4: TagGroup.requiredTag references.
  for (const entry of groupEntries) {
    if (!entry.requiredTag) continue;
    const requiredTagId = tagIdBySlug.get(entry.requiredTag) ?? null;
    if (!requiredTagId) {
      throw new Error(`docs/taggroups.yaml: group "${entry.slug}" references unknown requiredTag "${entry.requiredTag}"`);
    }
    const groupId = groupIdBySlug.get(entry.slug);
    const current = await prisma.tagGroup.findUnique({ where: { id: groupId }, select: { requiredTagId: true } });
    if (current.requiredTagId !== requiredTagId) {
      await prisma.tagGroup.update({ where: { id: groupId }, data: { requiredTagId } });
      linksUpdated += 1;
    }
  }

  // Pass 5: requirement.skills -> requirementSkills connections. Waits until
  // every Tag row exists (self-referential many-to-many).
  for (const entry of tagEntries) {
    const skillSlugs = entry.requirement?.skills ?? [];
    const tagId = tagIdBySlug.get(entry.slug);
    const skillIds = skillSlugs.map((slug) => {
      const id = tagIdBySlug.get(slug);
      if (!id) {
        throw new Error(`docs/tags.yaml: tag "${entry.slug}" references unknown requirement skill "${slug}"`);
      }
      return id;
    });

    const current = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { requirementSkills: { select: { id: true } } },
    });
    const currentIds = current.requirementSkills.map((t) => t.id).sort();
    const desiredIds = [...skillIds].sort();
    const changed =
      currentIds.length !== desiredIds.length || currentIds.some((id, i) => id !== desiredIds[i]);
    if (changed) {
      await prisma.tag.update({
        where: { id: tagId },
        data: { requirementSkills: { set: skillIds.map((id) => ({ id })) } },
      });
      linksUpdated += 1;
    }
  }

  // Pass 6: conflictsWith -> Tag.conflictsWith, written both directions so a
  // caller only ever checks one side.
  const conflictSlugsBySlug = new Map(tagEntries.map((t) => [t.slug, new Set()]));
  for (const entry of tagEntries) {
    for (const other of entry.conflictsWith ?? []) {
      conflictSlugsBySlug.get(entry.slug).add(other);
      conflictSlugsBySlug.get(other).add(entry.slug);
    }
  }
  for (const entry of tagEntries) {
    const tagId = tagIdBySlug.get(entry.slug);
    const desiredIds = [...conflictSlugsBySlug.get(entry.slug)]
      .map((slug) => tagIdBySlug.get(slug))
      .sort();

    const current = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { conflictsWith: { select: { id: true } } },
    });
    const currentIds = current.conflictsWith.map((t) => t.id).sort();
    const changed =
      currentIds.length !== desiredIds.length || currentIds.some((id, i) => id !== desiredIds[i]);
    if (changed) {
      await prisma.tag.update({
        where: { id: tagId },
        data: { conflictsWith: { set: desiredIds.map((id) => ({ id })) } },
      });
      linksUpdated += 1;
    }
  }

  // Editing a `weight:` or a `carryBonus` in the catalog changes what
  // everyone is carrying, so Overburdened has to be recomputed against the new
  // numbers. `{ drop: false }` settles the STATUS and never sheds: making a
  // sword heavier should make people overburdened, not dump a hundred
  // inventories onto the floor (CARRY.md §5).
  //
  // Every holder of a tradeable tag, not just the multiplier holders it used
  // to be — under weight, a catalog edit moves everybody's load.
  const holders = await prisma.character.findMany({
    where: { status: "ALIVE", tags: { some: { tag: { tradeable: true } } } },
    select: { id: true },
  });
  let rebased = 0;
  for (const { id } of holders) {
    const result = await settleCarry(prisma, id, { drop: false }).catch((err) => {
      console.error(`sync-tags: carry rebase failed for ${id}:`, err.message ?? err);
      return null;
    });
    if (result) rebased += 1;
  }

  return { groupsCreated, groupsUpdated, tagsCreated, tagsUpdated, linksUpdated, carryRebased: rebased };
}

module.exports = { syncTagsFromYaml };
