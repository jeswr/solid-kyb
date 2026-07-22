# AGENTS.md — Solid KYB walkthrough

> A README for coding agents. `CLAUDE.md` is a symlink to this file. This repo mirrors the
> structural scaffold of `jeswr/solid-lending` (Demo 2), rescoped for the KYB
> (business-onboarding) use case (design of record:
> `docs/research/kyb-demo-design.md` in `jeswr/solid-mortgage`, bead `sm-5ogg`).

## What this is (this phase)

**Foundation + vc-kit phase**: monorepo scaffold, `packages/data-model` (the RDF layer) and
`packages/vc-kit` (VC issue/verify/status/re-issue + the beneficial-ownership ZK prover,
sm-5ogg). No apps exist yet. The eventual shape (next build phase) is a
`create-solid-demo`-scaffolded walkthrough: a tour shell (`apps/tour`) rendering from one JSON
document, plus one app per ecosystem seat (`vault`, `issuers`, `bank-onboarding`,
`bank-credit`). Every branded surface will be a concept demonstration — all data simulated, no
real PII, `noindex` everywhere.

### packages/vc-kit — what's in it (sm-5ogg)

- `src/issue.ts`/`verify.ts`/`reissue.ts`/`status.ts`/`credential.ts` — VC 2.0 issue (via
  `@kyb/data-model`'s typed builders), fail-closed verify (shape + window + Bitstring status +
  signature), decision-0007-style re-issue (same claims, fresh window, old index revoked), and
  Bitstring Status List hosting. `eddsa-rdfc-2022` only, via the pinned `@jeswr/solid-vc`.
- `src/zk/` — the ZK layer for design §4's predicate ("no undisclosed beneficial owner holds
  >= 25%"): **Tier A** (`prover.ts`/`verifier.ts`'s `proveOwnerThreshold`/`verifyOwnerThreshold`)
  is a live per-owner `ownershipPercentageBps >= 2500` proof over the sparq `filter_int_d4`
  circuit family (`circuits/filter-int-d{1..4}.ts`, byte-identical artifacts to the
  mortgage/lending showcases' own committed set). **Tier B**
  (`proveCompleteness`/`verifyCompleteness`) is this package's OWN bespoke, project-authored
  circuit (`circuits/kyb-completeness-scan-n8.ts` + its real Nargo source at
  `circuits/kyb_completeness_scan/src/main.nr`) — compiled with the identical pinned toolchain,
  but NOT a member of sparq's own `zk/compose` family (no local sparq checkout was available to
  compile the design's `scan_k{1,2}_n{16,64}_r{4,8}` member). See the circuit file's PROVENANCE
  header for the full scope-down rationale — this is flagged for lead review.
- `src/zk/commitment.ts` — the Tier B owner-array commitment (Blake3, truncated to a BN254
  field element), computable entirely in JS (no native bridge needed, unlike Tier A).
- `src/seed-tooling/` — `mintOperandAnchors` equivalent (`anchors.ts`) for both ZK fields, plus
  the native sparq `encode_int_literal` bridge (`native.ts` + `scripts/sparq-helper`) Tier A
  anchors need — **gated on `SPARQ_CHECKOUT`, unbuilt/untested in this environment** (same
  honest posture as the mortgage/lending showcases' own native bridges). Tier A tests instead
  reuse GENUINE captured `filter_int_d4` fixtures from the sibling `jeswr/solid-lending` repo
  (same checkout commit, same toolchain, same circuit bytecode) rather than fabricating values.
- `test/` — 102 passing tests (1 skipped: the native-bridge integration test, gated on
  `SPARQ_CHECKOUT`), including real end-to-end UltraHonk prove+verify for BOTH tiers and a full
  forgeability-regression negative matrix (tampered anchors, stolen nonces, wrong fields/
  subjects, an UNDISCLOSED >= 25% owner making the completeness proof UNSATISFIABLE, etc).

## Non-negotiable conventions

1. **RDF discipline**: typed accessors over `@rdfjs/wrapper`, fetch+parse via
   `@jeswr/fetch-rdf` (once apps consume pods), serialize with the sanctioned
   `@jeswr/rdf-serialize` wrapper behind `resourceToTurtle()`. Never hand-built triples,
   never string-concatenated `.acl`.
2. **No minted IRIs — and no `urn:example:` either.** Only real, dereferenceable
   namespaces (FIBO Business Entities, OMG Commons, schema.org, W3C VC 2.0, DPV, SKOS)
   or the demo's own published-URL `kyb:` vocabulary at
   `https://solid-kyb-vocab.vercel.app/kyb#`. The lending demo shipped `urn:example:lend#`
   as a bug — this repo does not repeat it. **Hard rule (decision-0010 pattern): no `kyb:`
   IRI is minted into a LIVE/deployed surface before the `solid-kyb-vocab` Vercel project
   actually serves that namespace** — see `packages/data-model/vocab/kyb.ttl`'s header and
   the repo's open follow-up to deploy it (tracked as a `needs:user` bead in
   `jeswr/solid-mortgage`, since it requires Vercel account access this environment did not
   have when the data-model package was authored).
3. **SHACL validates all written data.** Every resource shape in
   `packages/data-model/shapes/*.ttl` is `sh:closed true`; `pnpm --filter @kyb/data-model
   run check:shapes` gates every shape + fixture.
4. **Fictional LEIs only.** Every LEI in this repo is ISO-17442-shaped and ISO 7064
   MOD-97-10 checksum-valid, but uses the never-GLEIF-accredited LOU prefix `9999` and
   carries `kyb:isIllustrativeLei true` — see `packages/data-model/src/lei.ts`. No surface
   may render a value that could be mistaken for a real GLEIF-issued LEI.
5. **Honest branding (future app phase)**: apps are "modelled on" organisations, never "by"
   them; hostnames and slugs derive from ROLES, never from modelled-on org names.
6. **Supply chain**: `.npmrc` sets `ignore-scripts=true`; CI installs with
   `--frozen-lockfile`.
7. **Framework deps are vendored tarballs (temporary)**: the @jeswr framework packages are
   not yet on npm; `vendor/*.tgz` + `pnpm.overrides` `file:` pins stand in until the publish
   lands (mirrors `jeswr/solid-lending` exactly — same versions).

## Gates

`pnpm lint && pnpm typecheck && pnpm test` must stay green; `pnpm build` builds every
package; `pnpm lint:iris` and `pnpm check:insignia` gate CI (`.github/workflows/ci.yml`).

## packages/data-model — what's in it

- `vocab/kyb.ttl` — the project residue vocabulary (generates `src/vocab/kyb.ts` via
  `node scripts/generate-vocab.mjs`).
- `shapes/*.ttl` — SHACL shapes for the three §3.2 VC types (organisational-identity,
  beneficial-ownership, officer-authorization), the bank-written CDD decision record, the
  ZK operand anchor, and shared support shapes (generates `src/shapes/shapes.ts` via
  `node scripts/generate-shapes.mjs`).
- `src/wrappers/` — typed `@rdfjs/wrapper` accessors (`build.ts` constructs documents,
  `resources.ts` defines the wrapper classes, `serialize.ts` is the sole SHACL-gated write
  path, `support.ts`/`mappings.ts` hold shared nodes and literal-mapping gotchas).
- `src/personas.ts` — Northwind Logistics LLC + its four fictional beneficial owners
  (Jordan Blake, Priya Nandakumar, Marcus Webb, Dana Reyes), pinned around the CDD Rule's
  25% (2,500 bps) beneficial-owner threshold.
- `src/lei.ts` — the ISO 17442/7064 fictional-LEI helpers.
- `test/` — Vitest unit suites (`testTimeout: 30_000` — real SHACL validation is slow cold).
