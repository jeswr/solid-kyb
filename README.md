# Solid KYB — Business Onboarding Walkthrough

A multistakeholder pod-data walkthrough for **KYB (Know Your Business)** onboarding:
a pnpm + Turborepo monorepo. This is the **foundation phase** — repo scaffold and the
RDF data-model package. The tour shell and zone apps (`tour`, `vault`, `issuers`,
`bank-onboarding`, `bank-credit`) are a later build phase; see
`docs/research/kyb-demo-design.md` in `jeswr/solid-mortgage` for the full design of
record (bead `sm-5ogg`).

> Concept demonstration by EDMA Solid Community of Practice. All data is simulated — no
> surface in this repo may present itself as a real service. No real LEI issuance and no
> real GLEIF vLEI (KERI/ACDC) — every LEI in this repo is an obviously-illustrative,
> ISO-17442-shaped, checksum-valid placeholder, never a GLEIF-issued identifier.

## Layout (this phase)

| Path | What |
|---|---|
| `packages/data-model` | Vocab (`vocab/kyb.ttl`), SHACL shapes, typed `@rdfjs/wrapper` accessors, and the Northwind Logistics LLC persona fixture |
| `packages/vc-kit` | **securityCritical** — VC 2.0 issue/verify/status/re-issue (`eddsa-rdfc-2022`) for the three KYB credential types, plus the beneficial-ownership ZK prover: Tier A live per-owner `ownershipPercentageBps >= 2500` threshold proof (sparq `filter_int_d4`) and Tier B's own bespoke, live-provable `kyb_completeness_scan_n8` completeness circuit ("no undisclosed beneficial owner >= 25%"). See `packages/vc-kit/src/zk/circuits/kyb-completeness-scan-n8.ts`'s PROVENANCE header for the Tier B scope note. |
| `packages/test-kit` | The dev/test Solid-server harness (`@jeswr/solid-server`, vendored) |
| `vendor/` | Packed tarballs of the not-yet-npm-published `@jeswr/*` framework packages (pinned via `pnpm.overrides` `file:` entries) |
| `scripts/` | `lint:iris` (every `https://` IRI must dereference) and `check:insignia` (banned-marks scan) gates |

Apps (`apps/tour`, `apps/vault`, `apps/issuers`, `apps/bank-onboarding`,
`apps/bank-credit`) and `seeds/`/`e2e/` land in the next build phase.

## The KYB vocabulary

Namespace: `https://solid-kyb-vocab.vercel.app/kyb#` — a real, dereferenceable URL this
project controls (decision-0010 pattern; **not** an `urn:example:` placeholder — see
`packages/data-model/vocab/kyb.ttl`'s header comment for why that matters and the
tracked follow-up to actually deploy the Vercel project before any `kyb:` IRI ships to
a live surface).

Grounding: FIBO Business Entities (`BE/LegalEntities/LEIEntities`,
`BE/LegalEntities/LegalPersons`, `BE/OwnershipAndControl/OwnershipParties`,
`BE/OwnershipAndControl/Executives`) `<->` GLEIF LEI `<->` FinCEN CDD Rule
(31 CFR §1010.230) — see the binding table in `docs/research/kyb-demo-design.md` §3.4.

## Quickstart

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @kyb/data-model test
```

> **Framework dependency status:** the @jeswr framework packages (solid-showcase,
> solid-showcase-kit, solid-pod-guard, synthetic-rdf, solid-seed, …) are pending their
> npm publish. This repo vendors their packed tarball closure under `vendor/` and pins
> them via `pnpm.overrides` `file:` entries (mirrors `jeswr/solid-lending`).
