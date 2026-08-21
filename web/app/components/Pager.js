import Link from "next/link";

// The one pager. Deliberately has no "use client" directive: rendered from a
// client component it just joins that bundle, and rendered from a server
// component (/gm/audit) it stays server-rendered — which is why the href form
// takes precomputed strings rather than a callback. A function prop cannot
// cross a server -> client boundary.
//
// Two postures, same markup: `onPage` for the in-memory tables, and
// `prevHref`/`nextHref` for /gm/audit, which pages over the URL so a filtered
// view stays linkable.
export default function Pager({ page, totalPages, total, unit = "rows", onPage, prevHref, nextHref }) {
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="flex items-center justify-between text-sm text-muted">
      <span>
        Page {page} of {totalPages} ({total} {unit})
      </span>
      <div className="flex gap-3">
        {hasPrev &&
          (onPage ? (
            <button type="button" className="menu-item" onClick={() => onPage(page - 1)}>
              Previous
            </button>
          ) : (
            <Link href={prevHref} className="menu-item">
              Previous
            </Link>
          ))}
        {hasNext &&
          (onPage ? (
            <button type="button" className="menu-item" onClick={() => onPage(page + 1)}>
              Next
            </button>
          ) : (
            <Link href={nextHref} className="menu-item">
              Next
            </Link>
          ))}
      </div>
    </div>
  );
}
