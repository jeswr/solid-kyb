#!/usr/bin/env node
/**
 * Generates src/vocab/kyb.ts (committed) from vocab/kyb.ttl, the single
 * source of truth for the KYB residue vocabulary.
 *
 *   node scripts/generate-vocab.mjs          # (re)write the constants module
 *   node scripts/generate-vocab.mjs --check  # exit 1 if the committed module drifted
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Parser } from "n3";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const VOCAB_TTL = path.join(PACKAGE_ROOT, "vocab", "kyb.ttl");
const OUTPUT = path.join(PACKAGE_ROOT, "src", "vocab", "kyb.ts");
const KYB_NAMESPACE = "https://solid-kyb-vocab.vercel.app/kyb#";
const KYB_ONTOLOGY_IRI = "https://solid-kyb-vocab.vercel.app/kyb";

function termLocalNames(quads) {
  const locals = new Set();
  for (const quad of quads) {
    if (quad.subject.termType === "NamedNode" && quad.subject.value.startsWith(KYB_NAMESPACE)) {
      locals.add(quad.subject.value.slice(KYB_NAMESPACE.length));
    }
  }
  return [...locals].sort((a, b) => a.localeCompare(b));
}

function constantKey(localName) {
  const key = localName.replaceAll("-", "_");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`term local name is not codegen-safe: ${localName}`);
  }
  return key;
}

export async function generateModule() {
  const turtle = await readFile(VOCAB_TTL, "utf8");
  const quads = new Parser({ format: "text/turtle" }).parse(turtle);
  const locals = termLocalNames(quads);
  if (locals.length === 0) throw new Error(`no kyb: terms found in ${VOCAB_TTL}`);

  const entries = locals
    .map((local) => {
      // Match Biome's formatter (lineWidth 100): break long entries after the key.
      const oneLine = `  ${constantKey(local)}: "${KYB_NAMESPACE}${local}",`;
      return oneLine.length <= 100
        ? oneLine
        : `  ${constantKey(local)}:\n    "${KYB_NAMESPACE}${local}",`;
    })
    .join("\n");
  return `// Generated from vocab/kyb.ttl by scripts/generate-vocab.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-vocab.mjs

/** Identity of the kyb residue vocabulary (a real, published-URL namespace — see vocab/kyb.ttl). */
export const KYB_ONTOLOGY_IRI = "${KYB_ONTOLOGY_IRI}";

/** Namespace of the kyb residue vocabulary. */
export const KYB_NAMESPACE = "${KYB_NAMESPACE}";

/**
 * IRI constants for every term defined in vocab/kyb.ttl
 * (hyphens in SKOS concept local names become underscores).
 */
export const KYB = {
${entries}
} as const;

/** Constant keys of the kyb vocabulary. */
export type KybTermKey = keyof typeof KYB;

/** Term IRIs of the kyb vocabulary. */
export type KybTermIri = (typeof KYB)[KybTermKey];
`;
}

const isCheck = process.argv.includes("--check");
const generated = await generateModule();
if (isCheck) {
  const committed = await readFile(OUTPUT, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error(
      `${path.relative(PACKAGE_ROOT, OUTPUT)} is stale - run: node scripts/generate-vocab.mjs`,
    );
    process.exit(1);
  }
  console.log("vocab constants are up to date");
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, generated);
  console.log(`wrote ${path.relative(PACKAGE_ROOT, OUTPUT)}`);
}
