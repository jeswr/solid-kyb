/**
 * The authenticated pod-route boundary for the Business Credit Desk's
 * decision (SECURITY-CRITICAL). Every handler:
 *
 *   1. requires a DPoP-bound Solid-OIDC caller — `@jeswr/solid-pod-guard`'s
 *      `createPodRouteGuard` (anonymous ⇒ 401 + `WWW-Authenticate`; caller-
 *      supplied `pod`/`webid` ⇒ 400; unconfigured issuer allowlist ⇒ 503) —
 *      NO simulated bypass exists in server code, in any runtime mode;
 *   2. derives `{webid, podBase}` from the TOKEN (the business's OWN
 *      authenticated session), never from request parameters;
 *   3. reads + verifies the granted org-identity + beneficial-ownership
 *      credentials over THIS DESK's OWN service-identity pod fetch
 *      (`createServicePodFetch`, client_credentials + DPoP) — the real WAC
 *      grant boundary the pod itself enforces against that identity. There
 *      is NO anonymous fallback: an unconfigured service identity fails
 *      closed (503), and a non-granted or revoked service identity is
 *      denied by the pod (401/403), never silently treated as "no data";
 *   4. runs the deterministic credit decision and writes the resulting
 *      `kyb:CddDecisionRecord` back into the business's pod, at a path
 *      scoped to THIS bank alone (`/kyb/decisions/bank-credit`) so a second,
 *      independent bank's decision never collides with the first
 *      (`bank-onboarding`)'s own.
 *
 * Fail-closed invariants (do NOT weaken): unconfigured OIDC-issuer allowlist
 * ⇒ 503; unconfigured service identity ⇒ 503; any binding/grant failure ⇒
 * the pod's own status code (401/403), never a pass; unexpected errors ⇒
 * 500, never approve.
 */
import { buildCddDecisionRecord, KYB, resourceToTurtle } from "@kyb/data-model";
import {
  createPodRouteGuard,
  createServicePodFetch,
  type OwnerBindingSeams,
  PodAccessError,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";
import type { BankCreditConfig } from "./config";
import { notConfigured, requiredConfig } from "./config";
import { readCddFile, type VerifySeams } from "./cdd-file";
import { runCreditDecision } from "./credit-decision";
import { readPodTurtle, writePodTurtle, type PodIoFetch } from "./pod-io";
import { publicRequestUrl as defaultPublicRequestUrl } from "./url";

/** This bank's own CDD decision path — distinct from a first bank's (`bank-onboarding`) own, so two independent banks' decisions never collide in the same pod. */
export const DECISION_POD_PATH = "/kyb/decisions/bank-credit";

export interface DecisionRailOptions {
  readonly config: BankCreditConfig;
  readonly guard?: PodRouteGuard;
  readonly podFetch?: PodIoFetch;
  readonly serviceWebId?: string;
  readonly now?: () => Date;
  readonly seams?: VerifySeams;
  readonly ownerSeams?: OwnerBindingSeams;
  readonly publicRequestUrl?: (request: Request) => string;
}

export interface DecisionRail {
  decide(request: Request): Promise<Response>;
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

export function createDecisionRail(options: DecisionRailOptions): DecisionRail {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  const guard: PodRouteGuard =
    options.guard ??
    createPodRouteGuard({
      config,
      ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
      publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
    });

  // Built lazily and cached: the service fetch owns a token cache + DPoP key,
  // and an unconfigured deployment must answer 503 (fail closed), not throw
  // at module load. NO anonymous fallback exists (see the module header).
  let scene: { podFetch: PodIoFetch; serviceWebId: string } | undefined;
  const sceneOptions = (): { podFetch: PodIoFetch; serviceWebId: string } | Response => {
    if (scene !== undefined) return scene;
    try {
      const serviceWebId = requiredConfig(
        options.serviceWebId ?? config.serviceWebId,
        "KYB_BANK_CREDIT_SERVICE_WEBID",
      );
      const podFetch =
        options.podFetch ??
        createServicePodFetch({
          allowInsecureLoopback: config.allowInsecureLoopback,
          clientId: requiredConfig(
            config.podServiceClientId,
            "KYB_BANK_CREDIT_POD_SERVICE_CLIENT_ID",
          ),
          clientSecret: requiredConfig(
            config.podServiceClientSecret,
            "KYB_BANK_CREDIT_POD_SERVICE_CLIENT_SECRET",
          ),
          issuer: requiredConfig(config.podServiceIssuer, "KYB_BANK_CREDIT_POD_SERVICE_ISSUER"),
        });
      scene = { podFetch, serviceWebId };
      return scene;
    } catch (error) {
      return errorResponse(error);
    }
  };

  return {
    async decide(request: Request): Promise<Response> {
      return guard.handle(request, async (caller) => {
        const grant = sceneOptions();
        if (grant instanceof Response) return grant;
        try {
          const nowValue = now();
          const file = await readCddFile(caller.podBase, caller.webid, config, {
            now: nowValue,
            podFetch: grant.podFetch,
            ...(options.seams !== undefined ? { seams: options.seams } : {}),
          });

          const decision = runCreditDecision({
            beneficialOwnership: file.beneficialOwnership,
            legalForm: file.claims?.legalForm,
            orgIdentity: file.orgIdentity,
            ownerCount: file.claims?.owners.length,
          });

          const base = caller.podBase.endsWith("/") ? caller.podBase : `${caller.podBase}/`;
          const decisionIri = `${base}${DECISION_POD_PATH.slice(1)}`;
          const decisionStatus =
            decision.outcome === "approve"
              ? KYB.CddDecisionStatus_Opened // the line of credit was opened
              : KYB.CddDecisionStatus_Declined;

          const record = buildCddDecisionRecord({
            checkDate: nowValue,
            checkedCredentials: [file.orgIdentity.iri, file.beneficialOwnership.iri],
            decisionStatus,
            iri: decisionIri,
          });
          const turtle = await resourceToTurtle(record);
          const existing = await readPodTurtle(decisionIri, grant.podFetch);
          await writePodTurtle(decisionIri, turtle, { existing, podFetch: grant.podFetch });

          return Response.json({
            claims: file.claims ?? null,
            decision,
            decisionIri,
            evaluatedAt: nowValue.toISOString(),
            simulated: true,
          });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  };
}
