import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import { BANK_CREDIT_APP } from "../lib/branding";
import { DecisionPanel } from "../components/decision-panel";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-28">
      <section>
        <p className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
          KYB business onboarding — scenes 3-4: reuse, not re-collection
        </p>
        <h1 className="font-semibold text-4xl text-foreground tracking-tight sm:text-5xl">
          {BANK_CREDIT_APP.appName}
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
          Modelled on {BANK_CREDIT_APP.modelledOn} — a SECOND bank, independent of the one that
          already opened Northwind Logistics LLC's business account. Instead of asking Northwind to
          re-submit its formation documents, EIN letter, or cap table, this desk reads the SAME
          organisational-identity and beneficial-ownership credentials already signed into
          Northwind's Data Vault, verifies them itself end to end, and decides a business line of
          credit — no re-collection, ever.
        </p>
      </section>

      <section aria-labelledby="why-reuse">
        <h2 className="font-semibold text-foreground text-xl" id="why-reuse">
          Why this is the payoff scene
        </h2>
        <ul className="mt-4 grid list-none gap-4 p-0 md:grid-cols-2">
          <li className="rounded-lg border border-border bg-card p-5">
            <p className="font-semibold text-card-foreground">One credential, two banks</p>
            <p className="mt-2 text-muted-foreground text-sm">
              The org-identity and beneficial-ownership credentials this desk reads are the exact
              same pod resources a first bank may already have read to open Northwind's account —
              never a second copy, never re-issued for this bank alone.
            </p>
          </li>
          <li className="rounded-lg border border-border bg-card p-5">
            <p className="font-semibold text-card-foreground">Independently re-verified</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Reuse does not mean blind trust: this desk runs the full fail-closed verify chain
              itself — signature, issuer trust, validity window, revocation status, and shape — on
              its own service identity's own authenticated read.
            </p>
          </li>
        </ul>
      </section>

      <DecisionPanel />

      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            {BANK_CREDIT_APP.honesty.real.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            {BANK_CREDIT_APP.honesty.simulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
      />
    </main>
  );
}
