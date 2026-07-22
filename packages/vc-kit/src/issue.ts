/**
 * Credential issuance: typed claims -> unsigned credential resource (via
 * `@kyb/data-model`'s typed builders) -> SHACL validation against the
 * matching KYB shape (fail-closed, BEFORE signing) -> `eddsa-rdfc-2022` Data
 * Integrity proof through `@jeswr/solid-vc`'s suite seam -> Turtle.
 *
 * Determinism contract: the library never reads the clock. `validity` and the
 * proof timestamp are explicit parameters, so backdated seeding (design §5
 * scene 1's validFrom -60d / validUntil +305d) is just an input.
 */

import {
  type BitstringStatusListEntry,
  type BitstringStatusListEntryInput,
  bitstringStatusListEntry,
  type DataIntegrityProof,
  DataIntegritySuite,
  type KeyPair,
  serialize,
} from "@jeswr/solid-vc";
import { type ShaclViolation, validate } from "@kyb/data-model";
import type { Quad } from "@rdfjs/types";
import { LiteralFrom, NamedNodeFrom, RequiredAs, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import {
  assertAbsoluteIri,
  buildKybCredentialResource,
  ClaimInputError,
  type CredentialEnvelope,
  type KybCredentialClaims,
} from "./claims.ts";
import { appendProof } from "./credential.ts";
import {
  type CredentialKind,
  credentialSchemaIri,
  RDF_TYPE,
  STATUS_BITSTRING_ENTRY,
  STATUS_LIST_CREDENTIAL,
  STATUS_LIST_INDEX,
  STATUS_PURPOSE,
  VC_CREDENTIAL_SCHEMA,
  VC_CREDENTIAL_STATUS,
  VC_VALID_FROM,
  VC_VALID_UNTIL,
} from "./vocab.ts";

/** The explicit validity window of a credential (no clock reads - pass dates). */
export interface ValidityWindow {
  readonly validFrom: Date;
  readonly validUntil?: Date;
}

export interface IssueCredentialOptions {
  /** The credential kind - selects the data-model builder, shape and schema IRI. */
  readonly kind: CredentialKind;
  /** The credential IRI - use the pod resource URL the document will live at. */
  readonly credentialId: string;
  /** The issuing party's WebID. */
  readonly issuer: string;
  /** The subject WebID (the business's own WebID; the holder-binding anchor). */
  readonly subject: string;
  /** The typed claims (must match `kind`). */
  readonly claims: KybCredentialClaims;
  /** Explicit validity window (supports backdated issuance). */
  readonly validity: ValidityWindow;
  /**
   * The Bitstring Status List entry for this credential (one list per issuer
   * app; status = revocation only - freshness is re-issuance). Validated
   * fail-closed via solid-vc's `bitstringStatusListEntry`. Every KYB
   * credential shape REQUIRES a status entry.
   */
  readonly status: BitstringStatusListEntry | BitstringStatusListEntryInput;
  /** The issuer's signing key (`eddsa-rdfc-2022` - Ed25519). */
  readonly key: KeyPair;
  /** The proof `created` timestamp. Defaults to `validity.validFrom`. */
  readonly proofCreated?: Date;
}

/** Issuance refused: the claim graph failed its KYB SHACL shape. */
export class IssueRefusedError extends Error {
  readonly violations: readonly ShaclViolation[];
  constructor(kind: CredentialKind, violations: readonly ShaclViolation[]) {
    const detail = violations
      .map(
        (violation) =>
          `- ${violation.message}${violation.path.length > 0 ? ` (path ${violation.path.join(" / ")})` : ""}`,
      )
      .join("\n");
    super(`refusing to sign a ${kind} that violates its shape:\n${detail}`);
    this.name = "IssueRefusedError";
    this.violations = violations;
  }
}

/** An issued (signed) credential, ready to store in a pod. */
export interface IssuedCredential {
  readonly credentialId: string;
  readonly kind: CredentialKind;
  /** The full signed document (claim graph + embedded proof). */
  readonly quads: readonly Quad[];
  /** The SIGNED subset (claim graph only) - what the proof covers. */
  readonly claimQuads: readonly Quad[];
  readonly proof: DataIntegrityProof;
  /** The document serialised for a pod `PUT`. */
  readonly body: string;
  readonly contentType: "text/turtle";
  /** The credential's status entry. */
  readonly status: BitstringStatusListEntry;
}

class StatusEntryWriteNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, (term) => term.value, NamedNodeFrom.string);
  }

  writeEntry(entry: BitstringStatusListEntry): void {
    this.types.add(STATUS_BITSTRING_ENTRY);
    RequiredAs.object(this, STATUS_PURPOSE, entry.statusPurpose, LiteralFrom.string);
    RequiredAs.object(this, STATUS_LIST_INDEX, entry.statusListIndex, LiteralFrom.string);
    RequiredAs.object(
      this,
      STATUS_LIST_CREDENTIAL,
      assertAbsoluteIri(entry.statusListCredential, "status.statusListCredential"),
      NamedNodeFrom.string,
    );
  }
}

function toStatusEntry(
  status: BitstringStatusListEntry | BitstringStatusListEntryInput,
): BitstringStatusListEntry {
  // Both shapes funnel through solid-vc's fail-closed validator (integer index,
  // known purpose, http(s) list URL) - a credential must never be signed over a
  // status entry its verifier cannot resolve.
  return bitstringStatusListEntry({
    statusPurpose: status.statusPurpose as "revocation" | "suspension",
    statusListIndex: status.statusListIndex,
    statusListCredential: status.statusListCredential,
    ...(status.id !== undefined ? { id: status.id } : {}),
  });
}

/**
 * Write a FRESH validity window + Bitstring status entry onto a credential
 * root that does not have them yet (the re-issue path: the carried-over claim
 * graph deliberately drops the OLD window/status before calling this).
 * Returns the validated {@link BitstringStatusListEntry} for the caller to
 * thread through to {@link finishIssue}.
 */
export function writeValidityAndStatus(
  store: Store,
  credentialTerm: import("@rdfjs/types").NamedNode,
  validity: ValidityWindow,
  status: BitstringStatusListEntry | BitstringStatusListEntryInput,
): BitstringStatusListEntry {
  const statusEntry = toStatusEntry(status);
  if (statusEntry.id === undefined) {
    throw new ClaimInputError(
      "status.id is required: the KYB credential shapes require credentialStatus to be an IRI, " +
        "so every status entry needs an explicit id (the status-list entry's own URL)",
    );
  }
  const credential = new CredentialEnvelopeWriteNode(credentialTerm, store, DataFactory);
  RequiredAs.object(credential, VC_VALID_FROM, validity.validFrom, LiteralFrom.dateTime);
  if (validity.validUntil !== undefined) {
    RequiredAs.object(credential, VC_VALID_UNTIL, validity.validUntil, LiteralFrom.dateTime);
  }
  RequiredAs.object(
    credential,
    VC_CREDENTIAL_STATUS,
    assertAbsoluteIri(statusEntry.id, "status.id"),
    NamedNodeFrom.string,
  );

  // Write the FULL status-list entry structure onto the status IRI just
  // linked (decision 0007's status = revocation-only posture, one list per
  // issuer app).
  const statusTerm = DataFactory.namedNode(assertAbsoluteIri(statusEntry.id, "status.id"));
  new StatusEntryWriteNode(statusTerm, store, DataFactory).writeEntry(statusEntry);
  return statusEntry;
}

class CredentialEnvelopeWriteNode extends TermWrapper {}

/** The graph-level tail of issuance, shared with re-issue. */
export interface FinishIssueOptions {
  readonly key: KeyPair;
  /** The proof `created` timestamp. */
  readonly proofCreated: Date;
}

/**
 * Complete issuance over a FULLY-BUILT claim graph (envelope, schema, subject
 * claims, validity window and status entry all already present): run the KYB
 * shape gate bound to the credential root (fail-closed, BEFORE signing), sign
 * with `eddsa-rdfc-2022`, embed the proof, serialise.
 */
export async function finishIssue(
  store: Store,
  credentialTerm: import("@rdfjs/types").NamedNode,
  kind: CredentialKind,
  statusEntry: BitstringStatusListEntry,
  options: FinishIssueOptions,
): Promise<IssuedCredential> {
  // Shape gate BEFORE signing, bound to the credential root (decoy-proof).
  const report = await validate(store, { expect: kind, focusNode: credentialTerm.value });
  if (!report.conforms) {
    throw new IssueRefusedError(kind, report.violations);
  }

  const claimQuads = [...store] as Quad[];
  const suite = new DataIntegritySuite("eddsa-rdfc-2022");
  const proof = await suite.sign(claimQuads, {
    key: options.key,
    proofPurpose: "assertionMethod",
    created: options.proofCreated,
  });
  appendProof(store, DataFactory, credentialTerm, proof);

  const quads = [...store] as Quad[];
  const body = await serialize(quads, "text/turtle");
  return {
    credentialId: credentialTerm.value,
    kind,
    quads,
    claimQuads,
    proof,
    body,
    contentType: "text/turtle",
    status: statusEntry,
  };
}

/**
 * Issue (sign) a KYB credential. Fail-closed ordering: the claim graph is
 * SHACL-validated against its KYB shape BEFORE any signature is produced - an
 * invalid payload throws {@link IssueRefusedError} and nothing is signed.
 */
export async function issueCredential(options: IssueCredentialOptions): Promise<IssuedCredential> {
  if (options.claims.kind !== options.kind) {
    throw new ClaimInputError(
      `claims.kind ${options.claims.kind} does not match kind ${options.kind}`,
    );
  }
  const statusEntry = toStatusEntry(options.status);
  if (statusEntry.id === undefined) {
    throw new ClaimInputError(
      "status.id is required: the KYB credential shapes require credentialStatus to be an IRI, " +
        "so every status entry needs an explicit id (the status-list entry's own URL)",
    );
  }
  const envelope: CredentialEnvelope = {
    credentialId: options.credentialId,
    issuer: options.issuer,
    subject: options.subject,
    validFrom: options.validity.validFrom,
    ...(options.validity.validUntil !== undefined
      ? { validUntil: options.validity.validUntil }
      : {}),
    credentialStatus: statusEntry.id,
  };
  const resource = buildKybCredentialResource(options.kind, envelope, options.claims);
  const store = resource.dataset as Store;
  const credentialTerm = DataFactory.namedNode(
    assertAbsoluteIri(options.credentialId, "credentialId"),
  );

  // credentialSchema (optional per shape, always populated here - the schema
  // that gates this document at issue AND verify time).
  RequiredAs.object(
    resource as unknown as TermWrapper,
    VC_CREDENTIAL_SCHEMA,
    credentialSchemaIri(options.kind),
    NamedNodeFrom.string,
  );

  // Write the FULL status-list entry structure onto the status IRI the
  // builder already linked (data-model only writes the bare IRI reference;
  // the embedded entry triples are vc-kit's - decision 0007's status =
  // revocation-only posture, one list per issuer app).
  const statusTerm = DataFactory.namedNode(assertAbsoluteIri(statusEntry.id, "status.id"));
  new StatusEntryWriteNode(statusTerm, store, DataFactory).writeEntry(statusEntry);

  return finishIssue(store, credentialTerm, options.kind, statusEntry, {
    key: options.key,
    proofCreated: options.proofCreated ?? options.validity.validFrom,
  });
}
