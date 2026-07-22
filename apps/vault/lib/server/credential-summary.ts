/**
 * Verify-on-view for the vault's credential list (scene 1): the FULL fail-closed
 * `verifyCredential` gate chain (signature, issuer key binding, validity window,
 * revocation status, SHACL shape) against the dev-seeded pod's three real signed KYB VCs.
 * NODE-ONLY — `@kyb/vc-kit`'s bundle statically imports `node:crypto` — this runs
 * server-side, browser-triggered, exactly like `./dev-seed.ts`.
 */
import { RESOURCE_POD_PATHS, type KybResourceKind } from "@kyb/data-model";
import { verifyCredential } from "@kyb/vc-kit";
import { ISSUER_POD_PATHS } from "./kyb-issuance";

export type CredentialStatusLabel = "valid" | "pending" | "expired" | "revoked";

export interface CredentialSummary {
  readonly id: string;
  readonly title: string;
  readonly issuer: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly status: CredentialStatusLabel;
  readonly errors: readonly string[];
}

const SUMMARY_CREDENTIALS: readonly {
  id: string;
  title: string;
  kind: KybResourceKind;
  path: string;
  issuerPath: string;
  issuerLabel: string;
}[] = [
  {
    id: "orgIdentity",
    title: "Organisational identity",
    kind: "org-identity-credential",
    path: RESOURCE_POD_PATHS["org-identity-credential"],
    issuerPath: ISSUER_POD_PATHS.orgIdentityRegistrar,
    issuerLabel: "Organisational-identity registrar — modelled on GLEIF",
  },
  {
    id: "beneficialOwnership",
    title: "Beneficial ownership",
    kind: "beneficial-ownership-credential",
    path: RESOURCE_POD_PATHS["beneficial-ownership-credential"],
    issuerPath: ISSUER_POD_PATHS.beneficialOwnershipRegistrar,
    issuerLabel: "Beneficial-ownership registrar — modelled on an unbranded business registry",
  },
  {
    id: "officerAuthorization",
    title: "Officer authorization",
    kind: "officer-authorization-credential",
    path: RESOURCE_POD_PATHS["officer-authorization-credential"],
    issuerPath: ISSUER_POD_PATHS.orgIdentityRegistrar,
    issuerLabel: "Organisational-identity registrar — modelled on GLEIF",
  },
];

function statusLabelFor(
  verified: boolean,
  errors: readonly { code: string }[],
): CredentialStatusLabel {
  if (verified) return "valid";
  if (
    errors.some((error) => error.code === "STATUS_REVOKED" || error.code === "STATUS_SUSPENDED")
  ) {
    return "revoked";
  }
  if (errors.some((error) => error.code === "EXPIRED")) return "expired";
  if (errors.some((error) => error.code === "NOT_YET_VALID")) return "pending";
  return "revoked";
}

export async function readCredentialSummaries(options: {
  readonly podBase: string;
  readonly now: Date;
}): Promise<readonly CredentialSummary[]> {
  return Promise.all(
    SUMMARY_CREDENTIALS.map(async (entry) => {
      const iri = `${options.podBase}${entry.path.slice(1)}`;
      const issuer = `${options.podBase}${entry.issuerPath.slice(1)}`;
      try {
        const response = await fetch(iri);
        if (!response.ok) {
          return {
            id: entry.id,
            title: entry.title,
            issuer: entry.issuerLabel,
            status: "revoked" as const,
            errors: [`could not read the credential (HTTP ${response.status})`],
          };
        }
        const turtle = await response.text();
        // Explicit plain fetch: solid-vc's DEFAULT webId/status resolver is SSRF-guarded
        // and refuses loopback http outright, with no config knob reaching it from here —
        // this dev-seeded pod is plain loopback http by design.
        const outcome = await verifyCredential(turtle, {
          expectShape: entry.kind,
          now: options.now,
          trustedIssuers: [issuer],
          webIdFetch: fetch,
          statusFetch: fetch,
        });
        return {
          id: entry.id,
          title: entry.title,
          issuer: entry.issuerLabel,
          ...(outcome.credential?.validFrom !== undefined
            ? { validFrom: outcome.credential.validFrom }
            : {}),
          ...(outcome.credential?.validUntil !== undefined
            ? { validUntil: outcome.credential.validUntil }
            : {}),
          status: statusLabelFor(outcome.verified, outcome.errors),
          errors: outcome.errors.map((error) => `${error.code}: ${error.message}`),
        };
      } catch (error) {
        return {
          id: entry.id,
          title: entry.title,
          issuer: entry.issuerLabel,
          status: "revoked" as const,
          errors: [(error as Error).message],
        };
      }
    }),
  );
}
