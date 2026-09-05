import { desireUnlocksFor } from "@/lib/desireUnlocks";

// The "Unlocks" block on a tag: which Desires holding it opens.
//
// One component for the surfaces that share no other panel code — TagChip's
// hover panel, PointBuy's hover panel AND its catalog rows, and the full
// TagDetailSheet — so the rule about what counts as an unlock is written once
// and they cannot drift apart. All of them pass the same tag row (selected
// with DESIRE_UNLOCK_SELECT); only spacing differs, via `compact`.
//
// EVERY ELEMENT HERE IS A <span>. PointBuy's catalog row is a <button>, which
// may contain phrasing content only — a <ul> or a <p> in there is invalid
// markup that React will happily render and the browser will reflow around.
// The layout is CSS's job instead (display: grid on a span costs nothing).
//
// No hooks and no client directive: TagChip renders on the SERVER at most of
// its call sites, and a context read here would break every one of them. The
// data rides the tag prop for exactly that reason.
//
// Renders nothing at all for the ~900 tags that unlock nothing, so an empty
// heading never appears.
export default function DesireUnlocks({ tag, visibleTagSlugs = null, compact = true }) {
  const rows = desireUnlocksFor(tag, { visibleTagSlugs });
  if (rows.length === 0) return null;

  return (
    <span className={compact ? "desire-unlocks" : "desire-unlocks desire-unlocks-roomy"}>
      <span className="desire-unlocks-head">
        Unlocks {rows.length} {rows.length === 1 ? "Desire" : "Desires"} ‡
      </span>
      <span className="desire-unlocks-list">
        {rows.map((row) => (
          <span className="desire-unlocks-row" key={row.slug}>
            <span className="desire-unlocks-name">{row.name}</span>
            {/* The tier IS the Tag Point award (docs/desires.yaml header), so
                this number is what fulfilling it pays — worth its own column.
                .mono because it is a number, per DESIGN-SYSTEM.md's data-only
                rule for the mono face. */}
            <span className="desire-unlocks-tier mono">{row.tier}</span>
            {/* Only present when the tag genuinely is not enough on its own —
                a second required tag, or a role alongside it. Absent is the
                common case and means "this tag opens it". */}
            {row.note && <span className="desire-unlocks-note">{row.note}</span>}
          </span>
        ))}
      </span>
    </span>
  );
}
