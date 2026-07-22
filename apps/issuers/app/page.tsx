import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { ISSUERS_APP } from "../lib/branding";
import { ISSUER_FLOW_IDS } from "../lib/server/config";
import { ISSUER_FLOWS } from "../lib/server/flows";

const FLOW_HREF: Record<(typeof ISSUER_FLOW_IDS)[number], string> = {
  "beneficial-ownership": "/beneficial-ownership",
  "officer-authorization": "/officer-authorization",
  "org-identity": "/org-identity",
};

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-28">
      <section>
        <p className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
          KYB business onboarding — scene 1: fill the vault
        </p>
        <h1 className="font-semibold text-4xl text-foreground tracking-tight sm:text-5xl">
          {ISSUERS_APP.appName}
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
          Three issuer flows — modelled on {ISSUERS_APP.modelledOn} — sign organisational-identity,
          beneficial-ownership, and officer-authorization verifiable credentials straight into a
          business's Data Vault pod. Verified once, re-used with every bank and counterparty that
          needs KYB instead of re-collected per application.
        </p>
      </section>

      <section aria-labelledby="issuer-flows">
        <h2 className="font-semibold text-foreground text-xl" id="issuer-flows">
          Issuer flows
        </h2>
        <ul className="mt-4 grid list-none gap-4 p-0 md:grid-cols-3">
          {ISSUER_FLOW_IDS.map((id) => {
            const definition = ISSUER_FLOWS[id];
            return (
              <li key={id}>
                <Link
                  className="block h-full rounded-lg border border-border bg-card p-5 no-underline transition-shadow hover:shadow-md"
                  href={FLOW_HREF[id]}
                >
                  <p
                    className="text-xs uppercase tracking-[0.15em]"
                    style={{ color: "var(--primary)" }}
                  >
                    {definition.role}
                  </p>
                  <p className="mt-2 font-semibold text-card-foreground">
                    modelled on {definition.modelledOn}
                  </p>
                  <p className="mt-3 text-muted-foreground text-sm">
                    Issues a <code>{definition.kind}</code>
                    {definition.mintsAnchors && " plus its ZK operand anchors"} into the business's
                    pod, with a per-flow Bitstring revocation list.
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            {ISSUERS_APP.honesty.real.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            {ISSUERS_APP.honesty.simulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
      />
    </main>
  );
}
