/**
 * Pod-resource conventions + a verified-read primitive for the bank-
 * onboarding rail (design §3.2/§4): the three §3.2 credentials (canonical
 * `@kyb/data-model` paths, shared with `apps/vault`'s grant catalogue) plus
 * the two design §4 ZK operand anchors (this app's own convention, mirroring
 * `apps/issuers`' live-issuance path family — `/kyb/credentials/zk/...` —
 * rather than `apps/vault`'s dev-seeder-only `/kyb/credentials/anchors/...`
 * convention, since this app is meant to integrate with the live issuer
 * rail). KNOWN CROSS-APP GAP (disclosed, not hidden): `apps/vault`'s grant
 * catalogue (`lib/grants/parties.ts`) does not yet cover ZK anchor
 * resources, only the three credentials — a live cross-app deployment needs
 * that catalogue extended before this app's anchor reads succeed against a
 * REAL vault grant; this app's own tests seed + grant the anchors directly
 * (test/support/seed.ts) so the ZK verification path is exercised for real
 * regardless.
 */
import { RESOURCE_POD_PATHS } from "@kyb/data-model";
import { verifyCredential, type VerifyCredentialOptions } from "@kyb/vc-kit";

export const CREDENTIAL_POD_PATHS = RESOURCE_POD_PATHS;

/** Pod-root-relative paths for the two design §4 ZK operand anchors. */
export const ANCHOR_POD_PATHS = {
  ownershipSample: "/kyb/credentials/zk/owner-sample-bps",
  arrayCommitment: "/kyb/credentials/zk/beneficial-ownership-array-commitment",
} as const;

export function podResourceIri(podBase: string, path: string): string {
  return `${podBase}${path.slice(1)}`;
}

/** A uniform verdict on one read+verify attempt — a fetch failure gets the
 * same shape as a shape/signature/status failure, never an unhandled throw. */
export interface EvidenceCheck {
  readonly iri: string;
  readonly turtle: string;
  readonly verified: boolean;
  readonly subject: string | undefined;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
}

export interface ReadVerifiedOptions
  extends Pick<VerifyCredentialOptions, "expectShape" | "now" | "trustedIssuers"> {
  readonly fetchImpl: typeof fetch;
}

/**
 * GET one pod resource and run it through the REAL fail-closed
 * `verifyCredential` gate chain (SHACL shape, validity window, Bitstring
 * status, `eddsa-rdfc-2022` signature). A fetch failure or non-2xx response
 * is folded into a synthetic `FETCH_FAILED` verdict rather than thrown —
 * every resource the bank reads gets an evidence verdict, never an
 * unhandled exception mid-decision.
 */
export async function readVerified(
  iri: string,
  options: ReadVerifiedOptions,
): Promise<EvidenceCheck> {
  let response: Response;
  try {
    response = await options.fetchImpl(iri, { headers: { accept: "text/turtle" } });
  } catch (error) {
    return {
      iri,
      turtle: "",
      verified: false,
      subject: undefined,
      errors: [
        { code: "FETCH_FAILED", message: `could not read ${iri}: ${(error as Error).message}` },
      ],
    };
  }
  if (!response.ok) {
    return {
      iri,
      turtle: "",
      verified: false,
      subject: undefined,
      errors: [{ code: "FETCH_FAILED", message: `could not read ${iri}: HTTP ${response.status}` }],
    };
  }
  const turtle = await response.text();
  const outcome = await verifyCredential(turtle, {
    expectShape: options.expectShape,
    now: options.now,
    trustedIssuers: options.trustedIssuers,
    webIdFetch: options.fetchImpl,
    statusFetch: options.fetchImpl,
  });
  return {
    iri,
    turtle,
    verified: outcome.verified,
    subject: outcome.credential?.subject,
    errors: outcome.errors,
  };
}
