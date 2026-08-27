import Tooltip from "./Tooltip";

// The little pfp that goes next to any GM-attributed row: a lock holder, a
// staged row's author, a reviewer. `profile` is `{ username, avatarUrl }`
// (see web/lib/gmProfiles.js#getGmProfiles) or null/undefined — nothing
// renders without one, so a caller with no profile data yet can pass it
// straight through.
//
// A plain <img>, not next/image: the source is Discord's CDN, which would
// otherwise need a remotePatterns entry, and at 13-16px there is nothing for
// an optimizer to save.
export default function GmAvatar({ profile, size = 16 }) {
  if (!profile) return null;
  const { username, avatarUrl } = profile;

  if (avatarUrl) {
    return (
      <Tooltip text={username}>
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{ borderRadius: "50%", display: "inline-block", verticalAlign: "middle" }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip text={username}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--field-bg)",
          border: "1px solid var(--border)",
          fontSize: "0.6rem",
          verticalAlign: "middle",
        }}
      >
        {username?.[0]?.toUpperCase() ?? "?"}
      </span>
    </Tooltip>
  );
}
