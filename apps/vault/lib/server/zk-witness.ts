/**
 * Read + VERIFY-ON-VIEW the scene-3 ZK-provable pod resources: the beneficial-ownership
 * credential (Tier B's full hidden owner array) and its two operand anchors (Tier A's
 * "sample owner" anchor, Tier B's array-commitment anchor). Every value is read ONLY after
 * the full fail-closed `verifyCredential` gate chain — an unverified value never becomes a
 * ZK witness.
 *
 * NODE-ONLY (mirrors `./dev-seed.ts`'s already-documented "no in-browser WASM runtime yet"
 * honesty note): `@kyb/vc-kit` statically imports `node:crypto` and cannot be pulled into a
 * browser bundle without a build failure, so this rail runs the real prove/verify round
 * trip in a Route Handler (Node runtime), browser-TRIGGERED. The witness values never leave
 * this process except as ZK proofs (never in the clear).
 */
import {
  BeneficialOwnershipCredential,
  type KybResourceKind,
  ZkOperandAnchor,
} from "@kyb/data-model";
import { verifyCredential } from "@kyb/vc-kit";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { ANCHOR_POD_PATHS, ISSUER_POD_PATHS } from "./kyb-issuance";

export class ZkWitnessError extends Error {}

export interface ZkWitnessBundle {
  /** The full hidden owner array, in the SAME order the anchor's array commitment covers. */
  readonly ownershipBps: readonly number[];
  /** How many of the hidden owners are disclosed as >= the threshold. */
  readonly disclosedCount: number;
  /** The Tier B array-commitment anchor's operand encoding + its own Turtle body. */
  readonly arrayCommitment: { readonly operandEnc: string; readonly anchorTurtle: string };
  /** The Tier A "sample owner" anchor's operand encoding + its own Turtle body (see
   * `./kyb-issuance.ts`'s header for why this is a captured value, not a live-encoded
   * exact persona figure). */
  readonly sampleOwner: { readonly operandEnc: string; readonly anchorTurtle: string };
}

function podPath(podBase: string, rootRelativePath: string): string {
  return `${podBase}${rootRelativePath.slice(1)}`;
}

async function verifiedTurtle(
  iri: string,
  expectShape: KybResourceKind,
  trustedIssuer: string,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<{ turtle: string; dataset: DatasetCore }> {
  const response = await fetchImpl(iri).catch((error: unknown) => {
    throw new ZkWitnessError(`could not read ${iri}: ${(error as Error).message}`);
  });
  if (!response.ok) {
    throw new ZkWitnessError(`could not read ${iri}: HTTP ${response.status}`);
  }
  const turtle = await response.text();
  const outcome = await verifyCredential(turtle, {
    expectShape,
    now,
    trustedIssuers: [trustedIssuer],
    webIdFetch: fetchImpl,
    statusFetch: fetchImpl,
  });
  if (!outcome.verified) {
    const detail = outcome.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    throw new ZkWitnessError(`${iri} did not verify: ${detail}`);
  }
  const dataset = new Store(new Parser({ format: "text/turtle", baseIRI: iri }).parse(turtle));
  return { turtle, dataset };
}

/** Read + verify the beneficial-ownership credential and both ZK operand anchors. */
export async function readZkWitnesses(options: {
  readonly podBase: string;
  readonly now: Date;
  readonly ownershipThresholdBps: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<ZkWitnessBundle> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { podBase, now } = options;

  const boIssuer = podPath(podBase, ISSUER_POD_PATHS.beneficialOwnershipRegistrar);

  const [beneficialOwnership, sampleAnchor, arrayAnchor] = await Promise.all([
    verifiedTurtle(
      podPath(podBase, "/kyb/credentials/beneficial-ownership"),
      "beneficial-ownership-credential",
      boIssuer,
      now,
      fetchImpl,
    ),
    verifiedTurtle(
      podPath(podBase, ANCHOR_POD_PATHS.ownershipSample),
      "zk-operand-anchor",
      boIssuer,
      now,
      fetchImpl,
    ),
    verifiedTurtle(
      podPath(podBase, ANCHOR_POD_PATHS.arrayCommitment),
      "zk-operand-anchor",
      boIssuer,
      now,
      fetchImpl,
    ),
  ]);

  const credentialIri = podPath(podBase, "/kyb/credentials/beneficial-ownership");
  const credential = new BeneficialOwnershipCredential(
    DataFactory.namedNode(credentialIri),
    beneficialOwnership.dataset,
    DataFactory,
  );
  const ownershipBps = [...credential.credentialSubject.ownershipRecords].map(
    (record) => record.ownershipPercentageBps,
  );
  const disclosedCount = ownershipBps.filter((bps) => bps >= options.ownershipThresholdBps).length;

  const sampleAnchorIri = podPath(podBase, ANCHOR_POD_PATHS.ownershipSample);
  const sampleResource = new ZkOperandAnchor(
    DataFactory.namedNode(sampleAnchorIri),
    sampleAnchor.dataset,
    DataFactory,
  );
  const arrayAnchorIri = podPath(podBase, ANCHOR_POD_PATHS.arrayCommitment);
  const arrayResource = new ZkOperandAnchor(
    DataFactory.namedNode(arrayAnchorIri),
    arrayAnchor.dataset,
    DataFactory,
  );

  return {
    ownershipBps,
    disclosedCount,
    arrayCommitment: {
      operandEnc: arrayResource.credentialSubject.operandEnc,
      anchorTurtle: arrayAnchor.turtle,
    },
    sampleOwner: {
      operandEnc: sampleResource.credentialSubject.operandEnc,
      anchorTurtle: sampleAnchor.turtle,
    },
  };
}
