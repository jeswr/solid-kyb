/**
 * Server-side configuration for the Business Credit Desk's reuse-and-decide
 * rail (design §5 scenes 3-4): read the SAME org-identity + beneficial-
 * ownership credentials `issuers` signed into the business's Data Vault pod,
 * verify them for real, and decide a business line of credit.
 *
 * The pod-guard base (`KYB_TRUSTED_OIDC_ISSUERS`, `KYB_POD_ALLOWED_ORIGINS`,
 * `KYB_DEV_ALLOW_LOOPBACK`, `KYB_TRUST_FORWARDED_HEADERS`) is read verbatim
 * from `@jeswr/solid-pod-guard`'s `configFromEnv("KYB")` — every app in this
 * workspace shares that prefix (mirrors `apps/vault`/`apps/issuers`). This
 * app adds its OWN service identity (L4) and the issuer allowlists
 * `verifyCredential` requires. Everything fails closed while unset.
 */
import { configFromEnv, type PodGuardConfig } from "@jeswr/solid-pod-guard";

export const ENV_PREFIX = "KYB";

export function guardConfig(): PodGuardConfig {
  return configFromEnv(ENV_PREFIX);
}

export interface BankCreditConfig extends PodGuardConfig {
  /**
   * Issuers trusted to sign the org-identity + beneficial-ownership
   * credentials this desk reads under a grant. REQUIRED for a credential to
   * pass full `verifyCredential`; an empty list fails the whole decision
   * rail closed (503) — no green tick, no "verified" claim, no decision on
   * unverifiable data.
   */
  readonly trustedCredentialIssuers: readonly string[];
  /** This desk's OWN identity — the `issuer`/`agent` of the CDD decision record it writes. */
  readonly bankCreditWebId: string;
  /**
   * The service identity (decision 0015 L4) the business's grant names for
   * read access to the granted credentials and write access to the CDD
   * decision record. `undefined` fails the rail closed (503) — there is NO
   * anonymous fallback.
   */
  readonly serviceWebId: string | undefined;
  /** OIDC issuer of the service identity (client_credentials + DPoP). */
  readonly podServiceIssuer: string | undefined;
  /** Confidential client id for the service identity. */
  readonly podServiceClientId: string | undefined;
  /** Confidential client secret for the service identity (server env only — never bundled). */
  readonly podServiceClientSecret: string | undefined;
}

function splitList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The demo bank's own identity IRI (RFC 2606 `.example`; role-first, matches the sibling showcases' convention — decision 0010). */
export const DEFAULT_BANK_CREDIT_WEBID = "https://bank-credit.example/orgs/business-credit-desk#id";

export function configFromEnvBankCredit(env: NodeJS.ProcessEnv = process.env): BankCreditConfig {
  return {
    ...configFromEnv(ENV_PREFIX, env),
    bankCreditWebId: env.KYB_BANK_CREDIT_WEBID?.trim() || DEFAULT_BANK_CREDIT_WEBID,
    podServiceClientId: env.KYB_BANK_CREDIT_POD_SERVICE_CLIENT_ID,
    podServiceClientSecret: env.KYB_BANK_CREDIT_POD_SERVICE_CLIENT_SECRET,
    podServiceIssuer: env.KYB_BANK_CREDIT_POD_SERVICE_ISSUER,
    serviceWebId: env.KYB_BANK_CREDIT_SERVICE_WEBID,
    trustedCredentialIssuers: splitList(env.KYB_BANK_CREDIT_TRUSTED_CREDENTIAL_ISSUERS),
  };
}

/** Standard "rail not configured" fail-closed response. */
export function notConfigured(detail: string): Response {
  return Response.json(
    {
      simulated: true,
      error: "not_configured",
      detail: `${detail} — this rail fails closed until an operator configures it`,
    },
    { status: 503 },
  );
}

/** A required, non-empty config string — absent values fail closed as 503 upstream. */
export function requiredConfig(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  return value;
}
