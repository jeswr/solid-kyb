/**
 * Shared ZK test rig. Proving is expensive (WASM cold start + genuine
 * UltraHonk proving, single-threaded in Node), so the suite proves each
 * scenario ONCE in a shared cache and reuses the transcript across the
 * negative matrix - negative tests vary the VERIFICATION inputs, which never
 * requires a new proof.
 *
 * TIER A FIXTURE PROVENANCE: this build environment has no local sparq
 * checkout (no `SPARQ_CHECKOUT`), so a FRESH genuine `encode_int_literal`
 * encoding cannot be minted here for this repo's own persona bps values (see
 * `src/seed-tooling/native.ts`). Tier A tests instead reuse GENUINE captured
 * `filter_int_d4` operand encodings from the sibling `jeswr/solid-lending`
 * vc-kit's own fixture capture (`test/fixtures/operand-enc.json` /
 * `PROVENANCE.json`, copied verbatim here) - the SAME sparq checkout commit,
 * SAME pinned toolchain, SAME circuit family (`filter_int_d4` is byte-
 * identical bytecode). The circuit does not care what real-world field a
 * digit-value represents, so a genuine (value, operandEnc) pair captured for
 * a different demo's field is a legitimate, non-fabricated witness for THIS
 * package's `ownershipPercentageBps` predicate (e.g. treating 2860 as a
 * hypothetical 28.60%-owner's stake, which is >= the 2500-bps/25% threshold).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KYB } from "@kyb/data-model";
import {
  type IssuedCredential,
  issueCredential,
  OWNERSHIP_THRESHOLD_BPS,
  proveOwnerThreshold,
  type TierAProof,
} from "../src/index.ts";
import {
  BACKDATED_VALIDITY,
  hostedStatusList,
  ISSUER,
  issuerKey,
  NOW,
  type StubHost,
  SUBJECT,
  stubHost,
} from "./support.ts";

const OPERAND_ENC_FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "operand-enc.json"), "utf8"),
) as { encodings: Record<string, string> };
export const OPERAND_ENC: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(OPERAND_ENC_FIXTURE.encodings).map(([value, enc]) => [Number(value), enc]),
);

export function encOf(value: number): string {
  const enc = OPERAND_ENC[value];
  if (enc === undefined) throw new Error(`no captured operand_enc fixture for ${value}`);
  return enc;
}

/** A genuine, in-budget, ABOVE-threshold value (28.60%, >= 25%). */
export const ABOVE_THRESHOLD_BPS = 2860;
/** A genuine, in-budget, BELOW-threshold value (22.00%, < 25%). */
export const BELOW_THRESHOLD_BPS = 2200;
/** A genuine, in-budget, ABOVE-threshold value used as the "adversary's real value". */
export const ADVERSARY_REAL_BPS = 500;
/** A genuine, in-budget value the adversary FORGES a proof over (never anchored to them). */
export const ADVERSARY_FORGED_BPS = 9999;

export const NONCE_ABOVE = "zk-test-nonce-owner-above-threshold";
export const NONCE_BELOW = "zk-test-nonce-owner-below-threshold";
export const NONCE_FORGED = "zk-test-nonce-owner-forged";

const proofCache = new Map<string, Promise<TierAProof>>();
function cachedProve(key: string, prove: () => Promise<TierAProof>): Promise<TierAProof> {
  let pending = proofCache.get(key);
  if (!pending) {
    pending = prove();
    proofCache.set(key, pending);
  }
  return pending;
}

/** A genuine proof of 2860 >= 2500 (filter_int_d4), for NONCE_ABOVE. */
export function aboveThresholdProof(): Promise<TierAProof> {
  return cachedProve("above", () =>
    proveOwnerThreshold({
      value: ABOVE_THRESHOLD_BPS,
      operandEnc: encOf(ABOVE_THRESHOLD_BPS),
      nonce: NONCE_ABOVE,
    }),
  );
}

/**
 * The FORGERY (decision-0012 regression): the adversary's real stake is 500
 * bps (5%, well under 25%), so they compute the salt-free encoding of 9999
 * themselves and prove `9999 >= 2500` - an HONEST proof of a true statement
 * about a value no issuer ever attested. Every cryptographic step succeeds;
 * only the anchor-equality gate can reject it.
 */
export function forgedProof(): Promise<TierAProof> {
  return cachedProve("forged", () =>
    proveOwnerThreshold({
      value: ADVERSARY_FORGED_BPS,
      operandEnc: encOf(ADVERSARY_FORGED_BPS),
      nonce: NONCE_FORGED,
    }),
  );
}

/** One-shot nonce consumer accepting exactly (sessionKey, nonce) - then burned. */
export function oneShotNonce(sessionKey: string, nonce: string) {
  let live = true;
  return {
    consume(gotSession: string, gotNonce: string): boolean {
      if (!live || gotSession !== sessionKey || gotNonce !== nonce) return false;
      live = false;
      return true;
    },
  };
}

export interface AnchorRig {
  readonly host: StubHost;
  readonly issue: (overrides?: {
    field?: string;
    operandEnc?: string;
    subject?: string;
    index?: number;
    validity?: { validFrom: Date; validUntil?: Date };
  }) => Promise<IssuedCredential>;
  readonly revoke: (index: number) => Promise<void>;
}

/**
 * An anchor-issuing rig: a stub-hosted Bitstring status list plus an issuer
 * that signs operand-anchor VCs against it. Defaults to a genuine
 * ownershipPercentageBps anchor for 2860, subject SUBJECT, status index 7.
 */
export async function anchorRig(): Promise<AnchorRig> {
  const host = stubHost();
  const list = await hostedStatusList(host);
  return {
    host,
    issue: async (overrides = {}) =>
      issueCredential({
        kind: "zk-operand-anchor",
        credentialId: "https://northwind.pod.example/kyb/credentials/anchors/ownership-jordan",
        issuer: ISSUER,
        subject: overrides.subject ?? SUBJECT,
        claims: {
          kind: "zk-operand-anchor",
          field: overrides.field ?? KYB.ownershipPercentageBps,
          operandEnc: overrides.operandEnc ?? encOf(ABOVE_THRESHOLD_BPS),
        },
        validity: overrides.validity ?? BACKDATED_VALIDITY,
        status: list.entry(overrides.index ?? 7),
        key: await issuerKey(),
      }),
    revoke: (index) => list.revoke(index, { now: NOW }),
  };
}

export { OWNERSHIP_THRESHOLD_BPS };
