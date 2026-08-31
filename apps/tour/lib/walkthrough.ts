// AUTHORED-BY Claude Sonnet 5
/**
 * THE document (single edit surface): apps/tour/content/walkthrough.json drives the
 * whole site. `parseWalkthrough` validates the schema, every cross-reference, and the
 * editorial budgets at module load — a broken document fails fast, everywhere at once.
 *
 * Loaded via `fs.readFileSync` + `JSON.parse`, NOT a static `import … from
 * "../content/walkthrough.json"` — the lending demo's e2e harness hit a JSON-import
 * bundling failure loading this same document (sm-bvuh); this app never reintroduces
 * that pattern, in the config, the app tree, or the tests, so every consumer of the
 * document loads it the identical, working way.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWalkthrough } from "@jeswr/solid-showcase";

const walkthroughJson = JSON.parse(
  readFileSync(join(process.cwd(), "content", "walkthrough.json"), "utf8"),
);

export const walkthrough = parseWalkthrough(walkthroughJson);
