/**
 * Server-side configuration for the bank-onboarding rail (design §2.2/§5
 * scene 2: "onboard without re-submitting").
 *
 * The pod-route boundary itself (DPoP-bound business-caller auth, the
 * bidirectional pim:storage pod binding, pod/webid override rejection) is
 * @jeswr/solid-pod-guard's `configFromEnv`/`createPodRouteGuard` — see
 * `guardConfig()` below (same shared `KYB` env prefix `apps/issuers` and
 * `apps/vault` already use). This app's OWN service identity (L4 pod IO,
 * reading the business's already-granted credentials) and the credential-
 * issuer allowlist are this app's own extension, read here. Everything fails
 * closed: an unset service identity or an empty issuer allowlist disables
 * the rail (503) rather than opening it.
 *
 * `KYB_BANK_ONBOARDING_SERVICE_WEBID` is not an arbitrary name — it is the
 * EXACT env var `apps/vault`'s grant catalogue
 * (`lib/grants/parties.ts`'s `GRANT_PARTIES["bank-onboarding"].envVar`)
 * already expects to name this app's service identity, so a live vault grant
 * to "bank-onboarding" targets the same WebID this app authenticates as.
 */
import { configFromEnv, type PodGuardConfig } from "@jeswr/solid-pod-guard";

export const ENV_PREFIX = "KYB";

export function guardConfig(): PodGuardConfig {
  return configFromEnv(ENV_PREFIX);
}

export interface BankOnboardingConfig {
  /** This app's OWN service WebID — the agent a business's vault grant names (L4). */
  readonly serviceWebId: string | undefined;
  /** OIDC issuer of the service identity (client_credentials + DPoP). */
  readonly podServiceIssuer: string | undefined;
  /** Confidential client id for the service identity. */
  readonly podServiceClientId: string | undefined;
  /** Confidential client secret for the service identity (server env only). */
  readonly podServiceClientSecret: string | undefined;
  /**
   * WebIDs trusted to issue the org-identity/beneficial-ownership/officer-
   * authorization credentials AND their ZK operand anchors (the GLEIF-
   * modelled org-identity registrar and the unbranded BO registrar, design
   * §3.2). An empty/unset allowlist fails closed — never "trust anyone".
   */
  readonly trustedCredentialIssuers: readonly string[];
}

function trimmed(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

function parseIssuerList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function bankOnboardingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BankOnboardingConfig {
  return {
    podServiceClientId: trimmed(env.KYB_BANK_ONBOARDING_POD_SERVICE_CLIENT_ID),
    podServiceClientSecret: trimmed(env.KYB_BANK_ONBOARDING_POD_SERVICE_CLIENT_SECRET),
    podServiceIssuer: trimmed(env.KYB_BANK_ONBOARDING_POD_SERVICE_ISSUER),
    serviceWebId: trimmed(env.KYB_BANK_ONBOARDING_SERVICE_WEBID),
    trustedCredentialIssuers: parseIssuerList(env.KYB_BANK_ONBOARDING_TRUSTED_CREDENTIAL_ISSUERS),
  };
}

/** A required, non-empty config string — absent values fail closed as 503 upstream. */
export function requiredConfig(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  return value;
}
