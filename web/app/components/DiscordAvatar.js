// A Discord user's profile picture.
//
// The app's first and only remote image — every other avatar in Lifeweb is a
// *character* avatar served locally by /api/avatar/[characterId]. This is the
// one place a Discord identity is shown rather than an in-game one, which is
// why it lives on the superadmin Gamemasters roster and nowhere else.
//
// Plain <img> rather than next/image deliberately: web/next.config.mjs
// declares no images.remotePatterns, so next/image against
// cdn.discordapp.com throws at render. Adding a remote pattern would also
// route a 28px avatar through the image optimizer for no benefit.
export default function DiscordAvatar({ discordUserId, avatar, name, size = 32 }) {
  // Discord's own fallback set, indexed by the user ID's snowflake — the same
  // default face the client shows for an account with no avatar set.
  const fallbackIndex = Number((BigInt(discordUserId) >> 22n) % 6n);
  const src = avatar
    ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;

  // No remotePatterns configured for cdn.discordapp.com, and nothing worth
  // optimizing at this size -- see the note above.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: "var(--r-full)", flexShrink: 0 }}
      title={name}
    />
  );
}
