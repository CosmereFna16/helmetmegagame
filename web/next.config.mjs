/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is a native/binary module used only inside "use server" actions
  // (avatar resizing). Without this, Turbopack tries to trace its
  // platform-detection code (which touches node:fs) into client bundles
  // that reference those actions, crashing with "Cannot find module
  // 'node:fs'" at runtime in the browser.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
