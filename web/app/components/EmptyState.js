// "There is nothing here" — one shape, in place of the seven the app had.
//
// Two forms, because a table's empty state is genuinely different markup from
// a panel's: EmptyRow spans the columns of a table, EmptyState is a line of
// prose anywhere else. Both say it the same way, in --muted at --fs-sm, so
// emptiness never reads as an error.
export default function EmptyState({ children, className = "" }) {
  return <p className={`empty-state ${className}`.trim()}>{children}</p>;
}

// `cols` counts the columns to span. Six of the app's ten table empty rows
// hardcoded that number as a literal, so adding a column silently left the
// empty row short and the table's last cell wrapped up into the wrong place —
// the four that got it right kept a file-local COL_COUNT const. Passing the
// count explicitly does not prevent that, but it does make the dependency
// visible at the call site rather than hiding it inside a magic number.
export function EmptyRow({ cols, children }) {
  return (
    <tr>
      <td colSpan={cols} className="empty-state text-center">
        {children}
      </td>
    </tr>
  );
}
