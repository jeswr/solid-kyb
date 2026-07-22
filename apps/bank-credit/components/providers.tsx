"use client";

import {
  AppShell,
  ConsentInterstitial,
  createDisclaimerPack,
  ShowcaseTrustProvider,
  themeFromSpec,
} from "@jeswr/solid-showcase-kit";
import type { ReactNode } from "react";
import { BANK_CREDIT_APP, KYB_BRANDING } from "../lib/branding";

/**
 * The non-removable trust frame: disclaimer pack + org theme from this app's
 * local branding config (see `lib/branding.ts` — standalone until
 * `apps/tour`'s walkthrough document exists), AppShell (variant "modelled" —
 * this surface is modelled ON Fifth Third Bank, never published BY it), and
 * the per-app consent interstitial.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const pack = createDisclaimerPack(KYB_BRANDING);
  const theme = themeFromSpec(BANK_CREDIT_APP.theme, BANK_CREDIT_APP.modelledOn);
  return (
    <ShowcaseTrustProvider pack={pack} theme={theme}>
      <AppShell appName={BANK_CREDIT_APP.appName} variant="modelled">
        {children}
      </AppShell>
      <ConsentInterstitial
        appId={BANK_CREDIT_APP.slug}
        learnMoreHref="/"
        organization={BANK_CREDIT_APP.modelledOn}
        variant="modelled"
      />
    </ShowcaseTrustProvider>
  );
}
