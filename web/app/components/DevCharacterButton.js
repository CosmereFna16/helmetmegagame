import Link from "next/link";
import { HammerIcon } from "./icons";

// Jumps from wherever a character is being looked at straight into the GM's
// editor for them. GM-only: there is no player-facing equivalent, so a missing
// characterId renders nothing rather than a dead button.
//
// Points at /gm/dev/characters/<id>, which is the character editor today and
// becomes the full Dev Character Panel later — the button doesn't care which.
export default function DevCharacterButton({ characterId, name }) {
  if (!characterId) return null;
  const label = name ? `Edit ${name} in the Dev panel` : "Open the Dev panel";
  return (
    <Link
      href={`/gm/dev/characters/${characterId}`}
      className="icon-btn"
      title={label}
      aria-label={label}
    >
      <HammerIcon width="15" height="15" />
    </Link>
  );
}
