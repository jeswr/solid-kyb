/**
 * The bank-onboarding rail (design §3/§4/§5 scene 2 "onboard without
 * re-submitting"): Bank of America-modelled full KYB/CDD relying party.
 *
 * Two routes:
 *  - `POST /api/kyb/challenge` — the AUTHENTICATED business mints this bank's
 *    single-use Tier A + Tier B ZK challenge nonces (design §4's "the bank
 *    issues a single-use nonce" — the `ZkNonceConsumer` seam,
 *    `@kyb/vc-kit`'s `verifyOwnerThreshold`/`verifyCompleteness`).
 *  - `POST /api/kyb/decision` — the SAME authenticated business presents the
 *    proofs it produced against those nonces (the VP-POST-style rail,
 *    decision 0012). This route:
 *      1. reads the org-identity, beneficial-ownership, and officer-
 *         authorization credentials directly from the business's pod (L4,
 *         `createServicePodFetch` — this app's OWN DPoP-bound service
 *         identity, `KYB_BANK_ONBOARDING_SERVICE_WEBID`) and runs the REAL
 *         fail-closed `verifyCredential` chain on each (SHACL shape,
 *         validity window, Bitstring status, `eddsa-rdfc-2022` signature) —
 *         disclosed, because CDD needs the actual values, not a proof;
 *      2. enforces L3 holder binding itself (a CONSUMER obligation per
 *         `@jeswr/solid-pod-guard`'s own SKILL.md) — every credential's
 *         `credentialSubject` must equal the DPoP-verified caller;
 *      3. reads the two ZK operand anchors from the pod and runs the REAL
 *         `verifyOwnerThreshold` (Tier A) and `verifyCompleteness` (Tier B)
 *         gate chains against the PRESENTED proofs — never a mock, never a
 *         self-check: this app is the verifier, the business is the prover;
 *      4. computes the disclosed >= 25%-owner count itself from the VERIFIED
 *         beneficial-ownership credential and uses THAT (never a client-
 *         claimed count) as the Tier B statement — a forged/understated
 *         claim fails Tier B's own `STATEMENT_MISMATCH` gate, not a value
 *         this route would otherwise have to trust;
 *      5. APPROVES (account opened) only when every gate above passes;
 *         otherwise DECLINES with specific CDD-Rule-framed reasons (31 CFR
 *         §1010.230, illustrative).
 *
 * Fail-closed throughout: an unconfigured service identity or an empty
 * credential-issuer allowlist answers 503, never falls back to anonymous or
 * untrusted pod IO.
 */
import {
  createPodRouteGuard,
  createServicePodFetch,
  PodAccessError,
  type OwnerBindingSeams,
  type PodGuardConfig,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";

/** Not re-exported from `@jeswr/solid-pod-guard`'s package barrel — mirrored here verbatim
 * (same pattern `apps/vault`'s `lib/grants/pod-io.ts` already uses). */
type PodIoFetch = typeof fetch;
import { BeneficialOwnershipCredential, KYB } from "@kyb/data-model";
import {
  OWNERSHIP_THRESHOLD_BPS,
  proofFromJson,
  verifyCompleteness,
  verifyOwnerThreshold,
  type PresentedProof,
  type TierAVerifyResult,
  type TierBVerifyResult,
} from "@kyb/vc-kit";
import { DataFactory, Parser, Store } from "n3";
import { type BankOnboardingConfig, requiredConfig } from "./config";
import {
  ANCHOR_POD_PATHS,
  CREDENTIAL_POD_PATHS,
  type EvidenceCheck,
  podResourceIri,
  readVerified,
} from "./pod-resources";
import { issueChallenge, nonceConsumer } from "./zk-nonces";

/** The same fixed "rail not configured" fail-closed shape
 * `@jeswr/solid-pod-guard`'s own `notConfigured` returns (not re-exported
 * from the package barrel, so mirrored here verbatim — same pattern
 * `apps/issuers`' issuer-rail.ts already uses). */
function notConfigured(detail: string): Response {
  return Response.json(
    {
      detail: `${detail} — this rail fails closed until an operator configures it`,
      error: "not_configured",
      simulated: true,
    },
    { status: 503 },
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof PodAccessError) {
    return Response.json(
      { detail: error.message, error: "pod_access", simulated: true },
      { status: error.status },
    );
  }
  if (error instanceof Error && error.message.endsWith("is unset")) {
    return notConfigured(error.message);
  }
  return Response.json({ error: "internal_error", simulated: true }, { status: 500 });
}

export interface OnboardingServiceOptions {
  readonly guardConfig: PodGuardConfig;
  readonly bank: BankOnboardingConfig;
  /** Owner-binding seams (profile fetch) for tests. */
  readonly ownerSeams?: OwnerBindingSeams;
  /** Public-URL reconstruction for the DPoP `htu` binding. Defaults to this app's basePath. */
  readonly publicRequestUrl?: (request: Request) => string;
  /** Injected in tests: reads the business's pod. Defaults to the L4 service identity. */
  readonly podFetch?: PodIoFetch;
  readonly now?: () => Date;
}

export interface OnboardingService {
  /** POST `/api/kyb/challenge` — mint this bank's single-use ZK nonces. */
  challenge(request: Request): Promise<Response>;
  /** POST `/api/kyb/decision` — verify credentials + ZK proofs, decide. */
  decision(request: Request): Promise<Response>;
}

interface ProofEnvelope {
  readonly sessionKey: string;
  readonly nonce: string;
  readonly proof: unknown;
}

interface DecisionRequestBody {
  readonly tierA: ProofEnvelope;
  readonly tierB: ProofEnvelope;
}

function readProofEnvelope(value: unknown): ProofEnvelope | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionKey !== "string" || record.sessionKey.length === 0) return undefined;
  if (typeof record.nonce !== "string" || record.nonce.length === 0) return undefined;
  return { sessionKey: record.sessionKey, nonce: record.nonce, proof: record.proof };
}

function parseDecisionBody(body: Record<string, unknown>): DecisionRequestBody | undefined {
  const tierA = readProofEnvelope(body.tierA);
  const tierB = readProofEnvelope(body.tierB);
  if (tierA === undefined || tierB === undefined) return undefined;
  return { tierA, tierB };
}

interface CheckSummary {
  readonly iri: string;
  readonly verified: boolean;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
}

function summarize(check: EvidenceCheck): CheckSummary {
  return { iri: check.iri, verified: check.verified, errors: check.errors };
}

/** How many of the beneficial-ownership credential's DISCLOSED owners are
 * >= the 25% threshold — read from the VERIFIED credential graph itself,
 * never a client-supplied number (the value the Tier B completeness proof
 * is checked against). Returns `undefined` if the graph cannot be read
 * (folded into a decline reason by the caller, never a thrown exception). */
function disclosedThresholdOwnerCount(check: EvidenceCheck): number | undefined {
  if (!check.verified) return undefined;
  try {
    const dataset = new Store(
      new Parser({ format: "text/turtle", baseIRI: check.iri }).parse(check.turtle),
    );
    const credential = new BeneficialOwnershipCredential(
      DataFactory.namedNode(check.iri),
      dataset,
      DataFactory,
    );
    let count = 0;
    for (const record of credential.credentialSubject.ownershipRecords) {
      if (record.ownershipPercentageBps >= OWNERSHIP_THRESHOLD_BPS) count += 1;
    }
    return count;
  } catch {
    return undefined;
  }
}

function defaultPublicRequestUrl(request: Request): string {
  return request.url;
}

export function createOnboardingService(options: OnboardingServiceOptions): OnboardingService {
  const { guardConfig, bank } = options;

  // Built lazily and cached: the service fetch owns a token cache + DPoP
  // key, and an unconfigured deployment must answer 503 (fail closed), not
  // throw at module load. NO anonymous fallback exists.
  let servicePodFetch: PodIoFetch | undefined;
  function getPodFetch(): PodIoFetch | Response {
    if (servicePodFetch !== undefined) return servicePodFetch;
    if (options.podFetch !== undefined) {
      servicePodFetch = options.podFetch;
      return servicePodFetch;
    }
    try {
      servicePodFetch = createServicePodFetch({
        allowInsecureLoopback: guardConfig.allowInsecureLoopback,
        clientId: requiredConfig(
          bank.podServiceClientId,
          "KYB_BANK_ONBOARDING_POD_SERVICE_CLIENT_ID",
        ),
        clientSecret: requiredConfig(
          bank.podServiceClientSecret,
          "KYB_BANK_ONBOARDING_POD_SERVICE_CLIENT_SECRET",
        ),
        issuer: requiredConfig(bank.podServiceIssuer, "KYB_BANK_ONBOARDING_POD_SERVICE_ISSUER"),
      });
      return servicePodFetch;
    } catch (error) {
      return errorResponse(error);
    }
  }

  function requireTrustedIssuers(): readonly string[] | Response {
    if (bank.trustedCredentialIssuers.length === 0) {
      return notConfigured("KYB_BANK_ONBOARDING_TRUSTED_CREDENTIAL_ISSUERS is unset");
    }
    return bank.trustedCredentialIssuers;
  }

  const guard: PodRouteGuard = createPodRouteGuard({
    config: guardConfig,
    ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
    publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
  });

  return {
    async challenge(request) {
      return guard.handle(request, async () => {
        const podFetch = getPodFetch();
        if (podFetch instanceof Response) return podFetch;
        const trustedIssuers = requireTrustedIssuers();
        if (trustedIssuers instanceof Response) return trustedIssuers;
        const challenge = issueChallenge(options.now);
        return Response.json({ simulated: true, ...challenge });
      });
    },

    async decision(request) {
      return guard.handle(request, async (caller, body) => {
        const podFetch = getPodFetch();
        if (podFetch instanceof Response) return podFetch;
        const trustedIssuers = requireTrustedIssuers();
        if (trustedIssuers instanceof Response) return trustedIssuers;

        const parsed = parseDecisionBody(body);
        if (parsed === undefined) {
          return Response.json(
            {
              detail: "body.tierA/tierB must each carry { sessionKey, nonce, proof }",
              error: "malformed_request",
              simulated: true,
            },
            { status: 400 },
          );
        }

        let tierAPresented: PresentedProof;
        let tierBPresented: PresentedProof;
        try {
          tierAPresented = proofFromJson(parsed.tierA.proof);
          tierBPresented = proofFromJson(parsed.tierB.proof);
        } catch (error) {
          return Response.json(
            { detail: (error as Error).message, error: "malformed_request", simulated: true },
            { status: 400 },
          );
        }

        const now = options.now?.() ?? new Date();

        const [orgIdentity, beneficialOwnership, officerAuthorization, sampleAnchor, arrayAnchor] =
          await Promise.all([
            readVerified(
              podResourceIri(caller.podBase, CREDENTIAL_POD_PATHS["org-identity-credential"]),
              { expectShape: "org-identity-credential", now, trustedIssuers, fetchImpl: podFetch },
            ),
            readVerified(
              podResourceIri(
                caller.podBase,
                CREDENTIAL_POD_PATHS["beneficial-ownership-credential"],
              ),
              {
                expectShape: "beneficial-ownership-credential",
                now,
                trustedIssuers,
                fetchImpl: podFetch,
              },
            ),
            readVerified(
              podResourceIri(
                caller.podBase,
                CREDENTIAL_POD_PATHS["officer-authorization-credential"],
              ),
              {
                expectShape: "officer-authorization-credential",
                now,
                trustedIssuers,
                fetchImpl: podFetch,
              },
            ),
            readVerified(podResourceIri(caller.podBase, ANCHOR_POD_PATHS.ownershipSample), {
              expectShape: "zk-operand-anchor",
              now,
              trustedIssuers,
              fetchImpl: podFetch,
            }),
            readVerified(podResourceIri(caller.podBase, ANCHOR_POD_PATHS.arrayCommitment), {
              expectShape: "zk-operand-anchor",
              now,
              trustedIssuers,
              fetchImpl: podFetch,
            }),
          ]);

        const reasons: string[] = [];

        function requireVerifiedAndBound(check: EvidenceCheck, label: string): void {
          if (!check.verified) {
            reasons.push(
              `${label} did not verify (CDD Rule 31 CFR §1010.230, illustrative): ` +
                `${check.errors.map((error) => error.code).join(", ") || "unknown error"}`,
            );
            return;
          }
          if (check.subject !== caller.webid) {
            reasons.push(`${label} is not bound to the authenticated caller's WebID`);
          }
        }

        requireVerifiedAndBound(orgIdentity, "organisational-identity credential");
        requireVerifiedAndBound(beneficialOwnership, "beneficial-ownership credential");
        requireVerifiedAndBound(officerAuthorization, "officer-authorization credential");

        const disclosedCount = disclosedThresholdOwnerCount(beneficialOwnership);
        if (disclosedCount === undefined) {
          reasons.push(
            "could not read the disclosed beneficial-ownership records to establish the " +
              "≥25%-owner count the completeness proof must match",
          );
        }

        const [tierAResult, tierBResult]: [TierAVerifyResult, TierBVerifyResult] =
          await Promise.all([
            verifyOwnerThreshold(tierAPresented, {
              // An empty `turtle` (the anchor could not be read from the
              // pod) parses to nothing and fails the anchor gate closed —
              // never skipped.
              anchorVc: sampleAnchor.turtle,
              webid: caller.webid,
              nonce: parsed.tierA.nonce,
              nonces: nonceConsumer,
              sessionKey: parsed.tierA.sessionKey,
              now,
              trustedIssuers,
              webIdFetch: podFetch,
              statusFetch: podFetch,
            }),
            verifyCompleteness(tierBPresented, {
              anchorVc: arrayAnchor.turtle,
              webid: caller.webid,
              nonce: parsed.tierB.nonce,
              nonces: nonceConsumer,
              sessionKey: parsed.tierB.sessionKey,
              now,
              trustedIssuers,
              // A missing disclosedCount forces a statement the honest proof
              // (produced for the REAL count) can never match — fail closed,
              // never "skip the gate".
              disclosedCount: disclosedCount ?? -1,
              webIdFetch: podFetch,
              statusFetch: podFetch,
            }),
          ]);

        if (!tierAResult.verified) {
          reasons.push(
            `beneficial-ownership per-owner threshold ZK proof did not verify: ` +
              `${tierAResult.errors[0]?.code ?? "unknown"} — ${tierAResult.errors[0]?.message ?? ""}`,
          );
        }
        if (!tierBResult.verified) {
          reasons.push(
            "beneficial-ownership completeness ZK proof did not verify — cannot rule out an " +
              `undisclosed ≥25% beneficial owner: ${tierBResult.errors[0]?.code ?? "unknown"} — ` +
              `${tierBResult.errors[0]?.message ?? ""}`,
          );
        }

        const status = reasons.length === 0 ? "opened" : "declined";

        return Response.json({
          simulated: true,
          status,
          decisionStatusIri:
            status === "opened" ? KYB.CddDecisionStatus_Opened : KYB.CddDecisionStatus_Declined,
          reasons,
          checkDate: now.toISOString(),
          checks: {
            orgIdentity: summarize(orgIdentity),
            beneficialOwnership: summarize(beneficialOwnership),
            officerAuthorization: summarize(officerAuthorization),
            disclosedThresholdOwnerCount: disclosedCount,
            tierA: tierAResult.checks,
            tierB: tierBResult.checks,
          },
        });
      });
    },
  };
}
