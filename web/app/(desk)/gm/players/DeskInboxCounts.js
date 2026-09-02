"use client";

import { useMemo } from "react";
import { mergeRailRows, useRailPatches } from "./liveInbox";
import { countInbox } from "./railCounts";

// The header's "N unread · N awaiting" chips, counted over the same live-
// merged rows the rail shows — otherwise the header would say 3 beside a rail
// showing 4 for up to 30 seconds.
export default function DeskInboxCounts({ rows, rowsAsOfMs }) {
  const patches = useRailPatches();
  const { unread, awaiting } = useMemo(
    () => countInbox(mergeRailRows(rows, patches, rowsAsOfMs)),
    [rows, patches, rowsAsOfMs],
  );
  return (
    <>
      {unread > 0 && <span className="chip text-xs text-muted">{unread} unread</span>}
      {awaiting > 0 && <span className="chip text-xs text-muted">{awaiting} awaiting</span>}
    </>
  );
}
