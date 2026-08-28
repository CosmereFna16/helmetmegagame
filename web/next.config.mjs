/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is a native/binary module used only inside "use server" actions
  // (avatar resizing). Without this, Turbopack tries to trace its
  // platform-detection code (which touches node:fs) into client bundles
  // that reference those actions, crashing with "Cannot find module
  // 'node:fs'" at runtime in the browser.
  serverExternalPackages: ["sharp"],

  // /gm/messages and the old /gm/players table merged into one desk at
  // /gm/players. Both old URLs are in GMs' history, in audit-log links and in
  // Discord scrollback, so they redirect rather than 404.
  //
  // permanent: false (307) on purpose: a 308 is cached by the browser more or
  // less forever, and this is an internal tool with no SEO to protect and a
  // real chance of another reshuffle.
  async redirects() {
    return [
      { source: "/gm/messages", destination: "/gm/players", permanent: false },
      {
        source: "/gm/messages/:discordUserId",
        destination: "/gm/players/:discordUserId",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
