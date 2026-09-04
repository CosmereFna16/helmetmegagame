"use client";

import { useState } from "react";
import {
  useTableState,
  SortHeader,
  FilterBar,
  TableScroll,
} from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import TagChip from "@/app/components/TagChip";
import TagDetailSheet from "@/app/components/TagDetailSheet";
import { formatCost, costColor } from "@/lib/characterCreation";

// The player-facing sibling of /gm/dev/tags's TagCatalog — same table
// machinery, but read-only: no Held column, no Origin column, no create/
// edit/delete. `tags` arrives already filtered server-side (see
// web/lib/tagCatalog.js), so nothing here needs to know about visibility.

const FILTER_DEFS = [
  { key: "category", label: "Category", value: (t) => t.category, minWidth: "11rem" },
  { key: "group", label: "Group", value: (t) => t.groupName ?? "—", minWidth: "12rem" },
];

const SEARCH_FIELDS = [(t) => t.name, (t) => t.slug, (t) => t.description];

export default function TagCatalogTab({ tags }) {
  const [viewing, setViewing] = useState(null); // null | {…tag} — the detail sheet

  const table = useTableState({
    rows: tags,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="panel flex flex-col gap-3 p-3">
        <FilterBar
          filterDefs={FILTER_DEFS}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search tags"
        />
      </div>

      <TableScroll minWidth="640px">
        <thead>
          <tr>
            <SortHeader label="Name" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Category" sortKey="category" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Group</th>
            <SortHeader label="Cost" sortKey="pointCost" sort={table.sort} onSort={table.toggleSort} />
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((t) => (
            <tr key={t.id}>
              <td>
                {/* The real chip with its hover card — the same tooltip the
                    rest of the app shows. HoverCard's trigger is itself
                    interactive (click pins the panel), so the chip can't
                    double as the sheet opener; Details beside it opens the
                    full read-only view instead. */}
                <div className="flex items-center gap-2">
                  <TagChip tag={t} />
                  <button
                    type="button"
                    className="btn-quiet text-xs"
                    onClick={() => setViewing(t)}
                  >
                    Details
                  </button>
                </div>
              </td>
              <td className="mono text-sm">{t.category}</td>
              <td className="text-sm text-muted">{t.groupName ?? "—"}</td>
              <td className="mono text-sm" style={{ color: costColor(t.pointCost) }}>
                {formatCost(t.pointCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </TableScroll>

      <Pager
        page={table.page}
        totalPages={table.totalPages}
        total={table.total}
        unit="tags"
        onPage={table.setPage}
      />

      {viewing && (
        <TagDetailSheet
          tag={viewing}
          tags={tags}
          onOpen={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}
