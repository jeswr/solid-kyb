import "./globals.css";
import { createDisclaimerPack } from "@jeswr/solid-showcase-kit";
import type { ReactNode } from "react";
import { AppProviders } from "../components/providers";
import { BANK_CREDIT_APP, KYB_BRANDING } from "../lib/branding";

// Concept-demo metadata (noindex + non-affiliation description). Keep it.
export const metadata = createDisclaimerPack(KYB_BRANDING).demoMetadata({
  appName: BANK_CREDIT_APP.appName,
  organization: BANK_CREDIT_APP.modelledOn,
  variant: "modelled",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
