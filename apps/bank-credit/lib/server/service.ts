import { configFromEnvBankCredit } from "./config";
import { createDecisionRail, type DecisionRail } from "./decision-rail";

/** Process singleton: the verifier owns the DPoP replay cache and must not be per-request. */
let rail: DecisionRail | undefined;

export function decisionRail(): DecisionRail {
  rail ??= createDecisionRail({ config: configFromEnvBankCredit() });
  return rail;
}
