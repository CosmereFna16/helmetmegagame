import Tooltip from "./Tooltip";

// The little face that goes next to a character's name wherever a GM scans a
// list of them: the player desk rail and roster, the adjudication queue, the
// dev panel, a conversation header. The web-only twin of GmAvatar (that one
// is a Discord identity; this one is the in-game one), served by
// /api/avatar/[characterId] — see PORTRAITS.md.
//
// `version` should be the character's updatedAt.getTime(). The avatar route
// answers with an immutable Cache-Control, so a stale version keeps a GM
// looking at a face from before the last rename or portrait change.
//
// A plain <img>, not next/image: the route serves arbitrary uploaded bytes at
// an unknown intrinsic size, which next/image would refuse without explicit
// dimensions, and there is nothing worth optimizing at this size.
export default function CharacterAvatar({ characterId, name, version, size = 20 }) {
  if (!characterId) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "var(--r-full)",
          background: "var(--field-bg)",
          border: "1px solid var(--border)",
          fontSize: "0.6rem",
          flexShrink: 0,
          verticalAlign: "middle",
        }}
      >
        {name?.[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }

  const src = `/api/avatar/${characterId}${version ? `?v=${version}` : ""}`;

  return (
    <Tooltip text={name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: "var(--r-full)",
          objectFit: "cover",
          flexShrink: 0,
          verticalAlign: "middle",
        }}
      />
    </Tooltip>
  );
}
