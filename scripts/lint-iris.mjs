#!/usr/bin/env node
/**
 * lint-iris.mjs — every https:// IRI in the walkthrough document (once it
 * exists), the vocab, and docs must dereference (house rule: no minted
 * IRIs). HEAD-checks with a 7-day cache (.cache/lint-iris.json); a 405/403 on
 * HEAD falls back to GET.
 *
 * Scope: apps/tour/content/walkthrough.json (once the tour app is built),
 * packages/data-model/vocab/kyb.ttl, and markdown docs. Add directories here
 * as you publish vocabularies of your own — a vocab IRI must resolve before
 * it ships.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCANNED_FILES = ["apps/tour/content/walkthrough.json", "README.md"];
const SCANNED_DIRS = ["docs"];
const SCANNED_GLOB_FILES = ["packages/data-model/vocab/kyb.ttl"];
/** Prefixes exempted from the check (add sparingly, with a reason). */
const ALLOWLIST = [
  "https://openapi.vercel.sh/", // vercel.json $schema — schema id, fetched by tooling
  "https://turborepo.dev/schema.json", // turbo.json $schema
  "https://biomejs.dev/schemas/", // biome.json $schema
  "https://json.schemastore.org/", // tsconfig $schema
  // TEMPORARY, tracked gap (docs/research/kyb-demo-design.md §3.5, decision-0010
  // pattern): the solid-kyb-vocab Vercel project has not been deployed yet — this
  // sandboxed environment had no Vercel account access when packages/data-model
  // was authored. The vocab/kyb.ttl namespace is the INTENDED real, permanent
  // hash namespace (mirrors the already-live solid-mortgage-vocab.vercel.app);
  // remove this entry the moment the project is deployed and re-run lint:iris to
  // confirm it resolves for real. No `kyb:` IRI may ship to a LIVE app surface
  // before that happens (the hard rule).
  "https://solid-kyb-vocab.vercel.app/",
];

const CACHE_PATH = ".cache/lint-iris.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const files = [...SCANNED_FILES, ...SCANNED_GLOB_FILES];
for (const dir of SCANNED_DIRS) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".md")) files.push(join(dir, entry));
  }
}

const iris = new Set();
const IRI_RE = /https:\/\/[^\s"'`<>\\)\]]+/g;
for (const file of files) {
  if (!existsSync(file)) continue;
  for (const match of readFileSync(file, "utf8").matchAll(IRI_RE)) {
    const iri = match[0].replace(/[.,;:]+$/, "");
    if (!ALLOWLIST.some((prefix) => iri.startsWith(prefix))) iris.add(iri);
  }
}

let cache = {};
if (existsSync(CACHE_PATH)) {
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    cache = {};
  }
}

const now = Date.now();
const failures = [];
for (const iri of [...iris].sort()) {
  const cached = cache[iri];
  if (cached !== undefined && now - cached.checkedAt < CACHE_TTL_MS && cached.ok) continue;
  let ok = false;
  let detail = "";
  try {
    let response = await fetch(iri, { method: "HEAD", redirect: "follow" });
    // Some WAFs/CDNs (observed: gleif.org) reject HEAD outright with a 404
    // even though GET serves the resource fine — retry with GET on any
    // non-2xx before concluding the IRI is actually broken.
    if (response.status >= 400) {
      response = await fetch(iri, { method: "GET", redirect: "follow" });
    }
    ok = response.status < 400;
    detail = `HTTP ${response.status}`;
  } catch (error) {
    detail = String(error);
  }
  cache[iri] = { checkedAt: now, ok };
  if (!ok) failures.push(`${iri} — ${detail}`);
}

mkdirSync(".cache", { recursive: true });
writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);

if (failures.length > 0) {
  process.stderr.write(`✗ ${failures.length} IRI(s) do not dereference:\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`✔ lint:iris — ${iris.size} IRI(s) dereference (7-day cache)\n`);
