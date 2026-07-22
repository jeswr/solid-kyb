import type { NextConfig } from "next";

/**
 * Zone app: served under the shell's rewrite prefix, so the basePath matches the
 * registry `path` for this app in the walkthrough content document.
 */
const nextConfig: NextConfig = {
  basePath: "/vault",
};

export default nextConfig;
