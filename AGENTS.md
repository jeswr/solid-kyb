# AGENTS.md — Solid KYB walkthrough

> A README for coding agents. `CLAUDE.md` is a symlink to this file. This repo mirrors the
> structural scaffold of `jeswr/solid-lending` (Demo 2), rescoped for the KYB
> (business-onboarding) use case (design of record:
> `docs/research/kyb-demo-design.md` in `jeswr/solid-mortgage`, bead `sm-5ogg`).

## What this is (this phase)

**Foundation phase only**: monorepo scaffold + `packages/data-model` (the RDF layer).
No apps exist yet. The eventual shape (next build phase) is a `create-solid-demo`-scaffolded
walkthrough: a tour shell (`apps/tour`) rendering from one JSON document, plus one app per
ecosystem seat (`vault`, `issuers`, `bank-onboarding`, `bank-credit`). Every branded surface
will be a concept demonstration — all data simulated, no real PII, `noindex` everywhere.

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
