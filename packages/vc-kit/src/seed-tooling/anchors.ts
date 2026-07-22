/**
 * `mintOperandAnchors` equivalent (design §4; mirrors the mortgage/lending
 * showcases' seed-tooling pattern): mints `kyb:ZkOperandAnchor` credentials
 * through the ordinary issuance gate (SHACL before signature), for BOTH
 * anchorable KYB fields:
 *
 *  - `kyb:ownershipPercentageBps` (Tier A, per-owner) - the caller supplies
 *    an ALREADY-COMPUTED `operandEnc` (from the native sparq bridge -
 *    `./native.ts` - or a genuine captured fixture; this module does not
 *    compute it itself);
 *  - `kyb:beneficialOwnershipArrayCommitment` (Tier B, the full owner array)
 *    - computed HERE, in pure JS, via `zk/commitment.ts` - no native bridge
 *    needed.
 *
 * The seeder (next build phase) calls these to write signed anchor VCs
 * beside the Beneficial-Ownership Credential in the business's pod.
 */

import { KYB } from "@kyb/data-model";
import type {
  BitstringStatusListEntry,
  BitstringStatusListEntryInput,
  KeyPair,
} from "@jeswr/solid-vc";
import { issueCredential, type IssuedCredential, type ValidityWindow } from "../issue.ts";
import { ownershipArrayCommitment } from "../zk/commitment.ts";

/** The envelope every anchor-minting call needs (mirrors `IssueCredentialOptions` minus claims). */
export interface MintAnchorOptions {
  readonly credentialId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly validity: ValidityWindow;
  readonly status: BitstringStatusListEntry | BitstringStatusListEntryInput;
  readonly key: KeyPair;
  readonly proofCreated?: Date;
}

/** Mint a `kyb:ZkOperandAnchor` for an arbitrary anchorable field + precomputed operand. */
export async function mintZkOperandAnchor(
  options: MintAnchorOptions & { readonly field: string; readonly operandEnc: string },
): Promise<IssuedCredential> {
  return issueCredential({
    kind: "zk-operand-anchor",
    credentialId: options.credentialId,
    issuer: options.issuer,
    subject: options.subject,
    claims: { kind: "zk-operand-anchor", field: options.field, operandEnc: options.operandEnc },
    validity: options.validity,
    status: options.status,
    key: options.key,
    ...(options.proofCreated !== undefined ? { proofCreated: options.proofCreated } : {}),
  });
}

/**
 * Mint the Tier A per-owner threshold anchor. `operandEnc` must be the
 * GENUINE sparq `encode_int_literal(value)` output for the owner's
 * `ownershipPercentageBps` value - obtain it from `./native.ts`'s bridge
 * (requires `SPARQ_CHECKOUT`) or a genuine captured `filter_int_d4` fixture;
 * this function does not compute or validate the encoding itself (the
 * on-chain gate is the circuit's own `assert` at proving time - see
 * `zk/prover.ts`'s `proveOwnerThreshold`, which fails UNSATISFIABLE on a
 * mismatched encoding).
 */
export async function mintOwnershipBpsAnchor(
  options: MintAnchorOptions & { readonly operandEnc: string },
): Promise<IssuedCredential> {
  return mintZkOperandAnchor({ ...options, field: KYB.ownershipPercentageBps });
}

/**
 * Compute the Tier B owner-array commitment (pure JS, no native bridge) and
 * mint its `kyb:ZkOperandAnchor`. `bps` is the FULL hidden owner array
 * (every owner, disclosed or not, <= 8 entries) in the SAME order the
 * completeness prover will later supply.
 */
export async function mintArrayCommitmentAnchor(
  options: MintAnchorOptions & { readonly bps: readonly number[] },
): Promise<{ readonly anchor: IssuedCredential; readonly arrayCommitment: string }> {
  const arrayCommitment = await ownershipArrayCommitment(options.bps);
  const anchor = await mintZkOperandAnchor({
    ...options,
    field: KYB.beneficialOwnershipArrayCommitment,
    operandEnc: arrayCommitment,
  });
  return { anchor, arrayCommitment };
}
