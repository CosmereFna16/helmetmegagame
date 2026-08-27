"use client";

import Link from "next/link";
import { KeepIcon } from "./icons";
import Tooltip from "./Tooltip";

// Jumps from wherever a character is being looked at straight into the GM's
// editor for them. GM-only: there is no player-facing equivalent, so a missing
// characterId renders nothing rather than a dead button.
//
// Two call shapes:
//   - No `onOpen`: a plain Link to /gm/dev/characters/<id> — the standalone
//     page, used anywhere outside the adjudication desk.
//   - `onOpen` given: a button that opens the Dev Panel as a modal over the
//     desk (web/app/(desk)/gm/turns/DevPanelModal.js) instead of navigating
//     away and losing the desk's state.
export default function DevCharacterButton({ characterId, name, onOpen }) {
  if (!characterId) return null;
  const label = name ? `Edit ${name} in the Dev panel` : "Open the Dev panel";

  if (onOpen) {
    return (
      <Tooltip text={label}>
        <button type="button" className="icon-btn" aria-label={label} onClick={onOpen}>
          <KeepIcon width="15" height="15" />
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip text={label}>
      <Link href={`/gm/dev/characters/${characterId}`} className="icon-btn" aria-label={label}>
        <KeepIcon width="15" height="15" />
      </Link>
    </Tooltip>
  );
}
