import { bankOnboardingConfigFromEnv, guardConfig } from "./config";
import { createOnboardingService, type OnboardingService } from "./onboarding-rail";

/** Process singleton: the verifier owns the DPoP replay cache and must not be per-request. */
let service: OnboardingService | undefined;

export function onboardingService(): OnboardingService {
  service ??= createOnboardingService({
    guardConfig: guardConfig(),
    bank: bankOnboardingConfigFromEnv(),
  });
  return service;
}
