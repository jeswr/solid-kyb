/**
 * Read + verify the SAME org-identity and beneficial-ownership credentials
 * `issuers` already signed into the business's Data Vault pod (design §5
 * scenes 2-4: "onboard without re-submitting" / "reuse, not re-collection").
 * This is the ONLY pod IO this desk performs before deciding — no document
 * is re-collected, re-uploaded, or re-typed; the same pod resources a first
 * bank (`bank-onboarding`) may already read are read again, independently,
 * by this SECOND bank.
 *
 * Access model (decision 0015 L4): the read runs over THIS APP's OWN
 * service identity fetch — the agent the business's grant names. The POD
 * enforces WAC against that identity; there is no anonymous fallback, so a
 * missing or revoked grant fails the run closed (`PodAccessError`) instead
 * of silently depending on an open pod.
 *
 * Trust model: pod RDF is untrusted input even under a grant. Each document
 * is SHACL-validated (via the typed wrappers) AND must ADDITIONALLY pass
 * `@kyb/vc-kit`'s fail-closed `verifyCredential` (signature + trusted issuer
 * + validity window + Bitstring status + shape) and attest the AUTHENTICATED
 * business (subject binding). The verification verdict is carried into the
 * credit-decision rule as an explicit evidence input — an unverifiable,
 * tampered, or unbound credential DECLINES the run; it never crashes it and
 * never silently approves.
 */
import {
  BeneficialOwnershipCredential,
  OrganisationalIdentityCredential,
  RESOURCE_POD_PATHS,
} from "@kyb/data-model";
import { isFresh, type VerifyCredentialOptions, verifyCredential } from "@kyb/vc-kit";
import { PodAccessError } from "@jeswr/solid-pod-guard";
import { DataFactory, Parser, Store } from "n3";
import type { BankCreditConfig } from "./config";
import { readPodTurtle } from "./pod-io";
import type { PodIoFetch } from "./pod-io";

/** Verification seams `verifyCredential` consumes — injected in tests with in-process issuer fixtures. */
export type VerifySeams = Pick<
  VerifyCredentialOptions,
  "resolveKey" | "isControlledBy" | "webIdFetch" | "statusFetch" | "trustedStatusIssuers"
>;

export interface CddEvidenceEntry {
  /** Full fail-closed `verifyCredential` verdict (signature + issuer + window + status + shape). */
  readonly verified: boolean;
  /** `credentialSubject == authenticated business WebID`. */
  readonly subjectBound: boolean;
  /** Validity-window check at the evaluation instant. */
  readonly fresh: boolean;
  /** Distinct verifier failure codes (diagnostics; never secrets). */
  readonly verifyErrors: readonly string[];
  /** The credential's own pod IRI (the CDD decision record's freshness audit trail). */
  readonly iri: string;
  readonly issuer: string;
}

export interface DisclosedOwner {
  readonly ownerName: string;
  readonly ownershipPercentage: number;
}

/** The reused, disclosed claim values — displayed as-is so the UI proves nothing was re-typed. */
export interface CddClaims {
  readonly businessName: string;
  readonly lei: string;
  readonly legalForm: string;
  readonly owners: readonly DisclosedOwner[];
}

export interface CddFile {
  readonly orgIdentity: CddEvidenceEntry;
  readonly beneficialOwnership: CddEvidenceEntry;
  /** `undefined` when either credential could not be read through its typed wrapper (evidence gate already failed). */
  readonly claims: CddClaims | undefined;
}

export interface CddFileOptions {
  /** The service identity's authenticated pod fetch (never anonymous). */
  readonly podFetch: PodIoFetch;
  readonly now: Date;
  readonly seams?: VerifySeams;
}

function parseTurtle(text: string, baseIri: string): Store {
  return new Store(new Parser({ baseIRI: baseIri, format: "text/turtle" }).parse(text));
}

async function readAndVerify(
  kind: "org-identity-credential" | "beneficial-ownership-credential",
  pod: string,
  webid: string,
  config: BankCreditConfig,
  options: CddFileOptions,
): Promise<{ entry: CddEvidenceEntry; dataset: Store; iri: string }> {
  const iri = `${pod}${RESOURCE_POD_PATHS[kind].slice(1)}`;
  const resource = await readPodTurtle(iri, options.podFetch);
  if (resource === undefined) {
    throw new PodAccessError(404, `the granted vault has no ${kind} document`);
  }
  const dataset = parseTurtle(resource.text, iri);

  // Explicit plain fetch under the dev/e2e loopback flag: solid-vc's DEFAULT
  // webId/status resolver is SSRF-guarded and refuses loopback http outright,
  // with no config knob reaching it from here — the granted pod under test
  // is plain loopback http by design (mirrors the lending showcase's
  // `bank-lender/lib/server/loan-file.ts` fallback verbatim).
  const seams: VerifySeams =
    options.seams ??
    (config.allowInsecureLoopback
      ? { statusFetch: fetch.bind(globalThis), webIdFetch: fetch.bind(globalThis) }
      : {});
  const verification = await verifyCredential(dataset, {
    expectShape: kind,
    now: options.now,
    trustedIssuers: config.trustedCredentialIssuers,
    ...seams,
  });
  const subjectBound =
    verification.credential?.subject !== undefined && verification.credential.subject === webid;
  const window = {
    validFrom: verification.credential?.validFrom,
    validUntil: verification.credential?.validUntil,
  };
  const entry: CddEvidenceEntry = {
    fresh: isFresh(window, options.now),
    iri,
    issuer: verification.credential?.issuer ?? "",
    subjectBound,
    verified: verification.verified,
    verifyErrors: [
      ...verification.errors.map((error) => error.code),
      ...(subjectBound ? [] : ["SUBJECT_MISMATCH"]),
    ],
  };
  return { dataset, entry, iri };
}

/**
 * Read the granted org-identity + beneficial-ownership credentials. `pod`
 * and `webid` are DERIVED from the authenticated caller by the route
 * boundary — never from request parameters. `podFetch` is the SERVICE
 * identity's own pod fetch; a non-granted or revoked reader gets denied by
 * the pod itself (401/403), which `readPodTurtle` surfaces as a thrown fetch
 * error the route boundary lowers to a response, never a silent empty read.
 */
export async function readCddFile(
  pod: string,
  webid: string,
  config: BankCreditConfig,
  options: CddFileOptions,
): Promise<CddFile> {
  if (config.trustedCredentialIssuers.length === 0) {
    throw new PodAccessError(
      503,
      "KYB_BANK_CREDIT_TRUSTED_CREDENTIAL_ISSUERS is unset — the decision rail fails closed",
    );
  }

  const [org, bo] = await Promise.all([
    readAndVerify("org-identity-credential", pod, webid, config, options),
    readAndVerify("beneficial-ownership-credential", pod, webid, config, options),
  ]);

  let claims: CddClaims | undefined;
  if (org.entry.verified && bo.entry.verified) {
    try {
      const orgWrapper = new OrganisationalIdentityCredential(
        DataFactory.namedNode(org.iri),
        org.dataset,
        DataFactory,
      );
      const boWrapper = new BeneficialOwnershipCredential(
        DataFactory.namedNode(bo.iri),
        bo.dataset,
        DataFactory,
      );
      const subject = orgWrapper.credentialSubject;
      claims = {
        businessName: subject.businessName,
        legalForm: subject.legalForm,
        lei: subject.legalEntityIdentifier.lei,
        owners: [...boWrapper.credentialSubject.ownershipRecords].map((record) => ({
          ownerName: record.owningEntity.ownerName,
          ownershipPercentage: record.ownershipPercentage,
        })),
      };
    } catch {
      // A wrapper-read failure on an otherwise-verified document is treated
      // as absent claims (never crashes the decision) — the evidence gate
      // below still runs off `verified`/`subjectBound`/`fresh` alone.
      claims = undefined;
    }
  }

  return { beneficialOwnership: bo.entry, claims, orgIdentity: org.entry };
}
