/**
 * The `@kyb/vc-kit`-backed issuance for the KYB seeder: real `eddsa-rdfc-2022` signing
 * (`issueCredential`), fresh Ed25519 issuer keys hosted at pod-relative WebID documents,
 * per-issuer Bitstring status lists, and the design §4 ZK operand anchors — Tier B (the
 * beneficial-ownership array commitment, pure JS Blake3, always minted for real) and Tier A
 * (per-owner `kyb:ownershipPercentageBps` thresholds, which need the NATIVE sparq
 * `encode_int_literal` bridge and a local `jeswr/sparq` checkout, `SPARQ_CHECKOUT`).
 * NEVER stubbed: every credential and anchor this module emits is a real signed VC that
 * passes `verifyCredential`'s full fail-closed gate chain against the documents it also
 * emits (`issuerResources`).
 *
 * Tier A honesty gate: minting a GENUINE per-owner operand encoding requires a local sparq
 * checkout (`@kyb/vc-kit/seed-tooling`'s `SparqEncodeHelper`, `native.ts`) — not available in
 * every build environment. When `SPARQ_CHECKOUT` (or `cargo`) is missing, `mintTierAAnchors`
 * returns a `"skipped-no-sparq-checkout"` outcome and mints NOTHING — an operand encoding is
 * never fabricated (house rule; mirrors `@kyb/vc-kit`'s own
 * `seed-tooling-native.test.ts`/`native.ts` gating exactly). The Tier B array-commitment
 * anchor needs no native bridge at all and is always genuinely minted.
 *
 * NODE-ONLY (`node:buffer`, `node:child_process` via the seed-tooling native bridge, and
 * `@kyb/vc-kit`'s `StatusListClient` uses `node:crypto` `createHash`) — this module is
 * consumed only by `./kyb-pod.ts`'s Node-only seeding entry point (the seeder integration
 * suite), never bundled into a browser app.
 */
import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { KYB } from "@kyb/data-model";
import {
  generateKeyPairForSuite,
  issueCredential,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  publishVerificationMethod,
  StatusListClient,
} from "@kyb/vc-kit";
import {
  mintArrayCommitmentAnchor,
  mintOwnershipBpsAnchor,
  type SparqNativeBridge,
  sparqEncodeHelperFromEnv,
} from "@kyb/vc-kit/seed-tooling";
import {
  ANCHOR_POD_PATHS,
  anchorValidity,
  type BeneficialOwnerValues,
  ISSUER_ROLES,
  type KybSeedIssuerRole,
  type ScriptedCredentialSeed,
} from "./credentials.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** In-memory GET/PUT host so signed status-list bodies can be captured as seed fixtures
 * before the pod resources exist (the wallet Mode-1 pattern — resources are written by
 * `@jeswr/solid-seed` afterwards, in one manifest-tracked pass). Ported from the sibling
 * `jeswr/solid-lending` seeder's identical helper (`seeds/issuance.ts`, read-only reference). */
function memoryResourceStore(): {
  fetch: typeof fetch;
  body(url: string): { body: string; contentType: string };
} {
  const resources = new Map<string, { body: string; contentType: string; version: number }>();
  const memoryFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const key = new URL(request.url).href;
    const existing = resources.get(key);
    if (request.method === "PUT") {
      if (request.headers.get("if-none-match") === "*" && existing !== undefined) {
        return new Response(null, { status: 412 });
      }
      const ifMatch = request.headers.get("if-match");
      if (ifMatch !== null && `"v${existing?.version ?? 0}"` !== ifMatch) {
        return new Response(null, { status: 412 });
      }
      const body = await request.text();
      resources.set(key, {
        body,
        contentType: request.headers.get("content-type") ?? "application/octet-stream",
        version: (existing?.version ?? 0) + 1,
      });
      return new Response(null, { status: existing === undefined ? 201 : 204 });
    }
    if (existing === undefined) return new Response("not found", { status: 404 });
    return new Response(existing.body, {
      status: 200,
      headers: { "content-type": existing.contentType, etag: `"v${existing.version}"` },
    });
  };
  return {
    fetch: memoryFetch,
    body(url: string) {
      const stored = resources.get(new URL(url).href);
      if (stored === undefined) throw new Error(`status list was never written: ${url}`);
      return { body: stored.body, contentType: stored.contentType };
    },
  };
}

interface SeedIssuer {
  readonly iri: string;
  readonly key: KeyPair;
  readonly status: StatusListClient;
  readonly docPath: string;
  readonly docBody: string;
  readonly statusPath: string;
  readonly finishStatusFixture: () => { path: string; body: string; contentType: string };
}

export interface KybIssuanceContext {
  readonly webid: string;
  /** Absolute resource IRI for a pod-BASE-relative path (base path preserved). */
  resolve(path: string): string;
}

/** One issued pod resource body (a `{ body, contentType }` solid-seed `DataSource`). Most
 * bodies are `text/turtle`; a hosted Bitstring status list is `application/vc+ld+json`
 * (`StatusListClient`'s own content type). */
export interface SeedResourceBody {
  readonly body: string;
  readonly contentType: string;
}

/** A seeded operand anchor: the signed VC plus its emission metadata. */
export interface SeededAnchorResource extends SeedResourceBody {
  readonly path: string;
  readonly field: string;
  readonly operandEnc: string;
}

/** The Tier B (array-commitment) mint outcome — ALWAYS real, pure JS, no native bridge. */
export interface TierBAnchorOutcome {
  readonly anchor: SeededAnchorResource;
  readonly arrayCommitment: string;
}

/**
 * The Tier A (per-owner threshold) mint outcome. `"minted"` carries one GENUINE anchor per
 * owner (native sparq `encode_int_literal` output); `"skipped-no-sparq-checkout"` means the
 * native bridge is unavailable in this environment — no anchor is minted and no encoding is
 * fabricated (see this module's header).
 */
export type TierAAnchorOutcome =
  | { readonly status: "minted"; readonly anchors: readonly SeededAnchorResource[] }
  | { readonly status: "skipped-no-sparq-checkout"; readonly reason: string };

/** The injected issuance seam `kyb-pod.ts` drives. */
export interface KybCredentialIssuance {
  issue(spec: ScriptedCredentialSeed, context: KybIssuanceContext): Promise<SeedResourceBody>;
  mintTierBAnchor(
    owners: readonly BeneficialOwnerValues[],
    context: KybIssuanceContext,
  ): Promise<TierBAnchorOutcome>;
  mintTierAAnchors(
    owners: readonly BeneficialOwnerValues[],
    context: KybIssuanceContext,
  ): Promise<TierAAnchorOutcome>;
  issuerResources(): Promise<readonly ({ readonly path: string } & SeedResourceBody)[]>;
}

export interface CreateKybIssuanceOptions {
  /** Pod BASE URL hosting the issuer documents + status lists (an origin, or an origin +
   * storage-root path — any path is PRESERVED in the issuer IRIs). */
  readonly podOrigin: string;
  /** The demo reference instant (drives status-list windows and anchor validity). */
  readonly now: Date;
  /**
   * Override the Tier A native bridge (test seam only — production always resolves it from
   * `SPARQ_CHECKOUT` via {@link sparqEncodeHelperFromEnv}). Never used to inject a fabricated
   * encoding into a real seeded pod.
   */
  readonly sparqBridge?: SparqNativeBridge;
}

function cargoAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("cargo", ["--version"], (error) => resolve(error === null));
  });
}

/**
 * Mirrors `@kyb/vc-kit`'s own `seed-tooling-native.test.ts` gate exactly
 * (`SPARQ_CHECKOUT !== undefined && cargoAvailable()`): the ONLY condition under which Tier
 * A anchor minting is skipped. Any OTHER failure (a checkout that exists but fails to build
 * or run) propagates as a real error — that is an environment bug to fix, not a reason to
 * silently fabricate or drop a genuine anchor.
 */
export async function tierANativeBridgeAvailable(): Promise<
  { readonly available: true } | { readonly available: false; readonly reason: string }
> {
  const checkout = process.env.SPARQ_CHECKOUT;
  if (checkout === undefined || checkout.length === 0) {
    return {
      available: false,
      reason:
        "SPARQ_CHECKOUT is not set — minting a genuine Tier A ownershipPercentageBps operand " +
        "encoding requires a local jeswr/sparq checkout, not available in this build " +
        "environment; reuse a genuine captured fixture instead, or run this against a " +
        "checkout to mint fresh anchors (see @kyb/vc-kit/seed-tooling's native.ts).",
    };
  }
  if (!(await cargoAvailable())) {
    return {
      available: false,
      reason:
        "cargo is not on PATH — building scripts/sparq-helper against the SPARQ_CHECKOUT " +
        "requires the Rust toolchain, which is not available in this build environment.",
    };
  }
  return { available: true };
}

/**
 * Build the vc-kit-backed issuance for one pod. Issuer keys are freshly generated per seed
 * run (honest for per-boot demo pods — no cross-run issuer identity exists, and no private
 * key is ever committed).
 */
export function createKybIssuance(options: CreateKybIssuanceOptions): KybCredentialIssuance {
  // Storage-root path preserved; trailing slash dropped so `${podRoot}${"/x"}` joins
  // cleanly with the pod-base-relative issuer paths.
  const podRoot = new URL(options.podOrigin).origin;
  const issuers = new Map<KybSeedIssuerRole, Promise<SeedIssuer>>();

  async function provisionIssuer(role: KybSeedIssuerRole): Promise<SeedIssuer> {
    const definition = ISSUER_ROLES[role];
    const iri = `${podRoot}${definition.docPath}`;
    const key = await generateKeyPairForSuite(`${iri}#key-1`, "Ed25519");
    const published = await publishVerificationMethod({ controller: iri, key });
    const store = memoryResourceStore();
    const statusUrl = `${podRoot}${definition.statusPath}`;
    const status = new StatusListClient({ url: statusUrl, issuer: iri, key, fetch: store.fetch });
    await status.create({
      now: options.now,
      validUntil: new Date(options.now.getTime() + 180 * DAY_MS),
      bits: Buffer.alloc(MIN_STATUS_LIST_LENGTH / 8),
    });
    return {
      iri,
      key,
      status,
      docPath: definition.docPath,
      docBody: published.turtle,
      statusPath: definition.statusPath,
      finishStatusFixture: () => {
        const captured = store.body(statusUrl);
        return {
          path: definition.statusPath,
          body: captured.body,
          contentType: captured.contentType,
        };
      },
    };
  }

  function issuerFor(role: KybSeedIssuerRole): Promise<SeedIssuer> {
    let issuer = issuers.get(role);
    if (issuer === undefined) {
      issuer = provisionIssuer(role);
      issuers.set(role, issuer);
    }
    return issuer;
  }

  return {
    async issue(spec, context) {
      const issuer = await issuerFor(spec.issuerRole);
      const credential = await issueCredential({
        kind: spec.kind,
        credentialId: context.resolve(spec.path),
        issuer: issuer.iri,
        subject: context.webid,
        claims: spec.claims,
        validity: { validFrom: spec.validFrom, validUntil: spec.validUntil },
        status: issuer.status.entry(spec.statusIndex),
        key: issuer.key,
      });
      return { body: credential.body, contentType: credential.contentType };
    },

    async mintTierBAnchor(owners, context) {
      const issuer = await issuerFor("beneficialOwnershipRegistrar");
      const { anchor, arrayCommitment } = await mintArrayCommitmentAnchor({
        credentialId: context.resolve(ANCHOR_POD_PATHS.ownerArrayCommitment),
        issuer: issuer.iri,
        subject: context.webid,
        validity: anchorValidity(options.now),
        status: issuer.status.entry(39),
        key: issuer.key,
        bps: owners.map((owner) => owner.ownershipPercentageBps),
      });
      return {
        anchor: {
          path: ANCHOR_POD_PATHS.ownerArrayCommitment,
          field: KYB.beneficialOwnershipArrayCommitment,
          operandEnc: arrayCommitment,
          body: anchor.body,
          contentType: anchor.contentType,
        },
        arrayCommitment,
      };
    },

    async mintTierAAnchors(owners, context) {
      const availability = await tierANativeBridgeAvailable();
      if (!availability.available) {
        return { status: "skipped-no-sparq-checkout", reason: availability.reason };
      }
      const bridge = options.sparqBridge ?? sparqEncodeHelperFromEnv();
      const result = await bridge.run({
        encodeInts: owners.map((owner) => owner.ownershipPercentageBps),
      });
      const issuer = await issuerFor("beneficialOwnershipRegistrar");
      const anchors: SeededAnchorResource[] = [];
      let index = 40;
      for (const owner of owners) {
        const operandEnc = result.encodings[String(owner.ownershipPercentageBps)];
        if (operandEnc === undefined) {
          throw new Error(
            `native sparq bridge did not return an encoding for ${owner.ownershipPercentageBps} ` +
              `bps (${owner.name})`,
          );
        }
        const path = ANCHOR_POD_PATHS.ownershipBps(owner.name);
        const anchorCredential = await mintOwnershipBpsAnchor({
          credentialId: context.resolve(path),
          issuer: issuer.iri,
          subject: context.webid,
          validity: anchorValidity(options.now),
          status: issuer.status.entry(index),
          key: issuer.key,
          operandEnc,
        });
        anchors.push({
          path,
          field: KYB.ownershipPercentageBps,
          operandEnc,
          body: anchorCredential.body,
          contentType: anchorCredential.contentType,
        });
        index += 1;
      }
      return { status: "minted", anchors };
    },

    async issuerResources() {
      const provisioned = await Promise.all([...issuers.values()]);
      if (provisioned.length === 0) {
        throw new Error("no issuer was provisioned — issue() must run before issuerResources()");
      }
      return provisioned.flatMap((issuer) => [
        { path: issuer.docPath, body: issuer.docBody, contentType: "text/turtle" },
        issuer.finishStatusFixture(),
      ]);
    },
  };
}
