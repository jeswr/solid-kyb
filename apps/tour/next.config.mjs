// AUTHORED-BY Claude Sonnet 5
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWalkthrough } from "@jeswr/solid-showcase";
import { zoneRewrites } from "@jeswr/solid-showcase/next";

/**
 * The multi-zone rewrite table derives from the SAME walkthrough document that renders
 * the site — no duplicated zone list. Zone URLs are read from env at BUILD time
 * (unset ⇒ an unresolvable `.invalid` fallback: honest "not deployed", never a real
 * route). Read via fs (not an import) because next.config is bundled standalone.
 *
 * NOTE: this file is `.mjs`, not `.ts` — Next evaluates a TS config through a CJS
 * require, and the @jeswr framework packages publish an `import`-only exports map, so
 * the `.ts` variant fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Native ESM (`.mjs`)
 * honours the `import` condition. Same fix as `jeswr/solid-lending` (sm-bvuh's
 * companion JSON-import-bundling lesson: read walkthrough.json via `fs.readFileSync` +
 * `JSON.parse`, never a static JSON import, anywhere this document is consumed
 * server-side in this app).
 */
const walkthrough = parseWalkthrough(
  JSON.parse(readFileSync(join(process.cwd(), "content", "walkthrough.json"), "utf8")),
);

/** @type {import("next").NextConfig} */
const nextConfig = {
  rewrites: () => zoneRewrites(walkthrough),
};

export default nextConfig;
