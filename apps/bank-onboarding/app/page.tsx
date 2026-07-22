import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import { BANK_ONBOARDING_APP } from "../lib/branding";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-28">
      <section>
        <p className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
          KYB business onboarding — scene 2: onboard without re-submitting
        </p>
        <h1 className="font-semibold text-4xl text-foreground tracking-tight sm:text-5xl">
          {BANK_ONBOARDING_APP.appName}
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
          Modelled on {BANK_ONBOARDING_APP.modelledOn}: a business banking Customer Due Diligence
          (CDD) relying party that reads a business&apos;s already-issued organisational-identity
          and beneficial-ownership credentials straight from its own Data Vault pod — plus a
          beneficial-ownership completeness zero-knowledge proof — instead of re-collecting
          formation documents, an EIN letter, and a cap table from scratch.
        </p>
      </section>

      <section aria-labelledby="kyb-check">
        <h2 className="font-semibold text-foreground text-xl" id="kyb-check">
          What this bank checks before opening an account
        </h2>
        <ul className="mt-4 grid list-none gap-4 p-0 md:grid-cols-2">
          <li className="rounded-lg border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-[0.15em]" style={{ color: "var(--primary)" }}>
              Disclosed, verified credentials
            </p>
            <p className="mt-2 font-semibold text-card-foreground">
              Organisational identity, beneficial ownership, officer authorization
            </p>
            <p className="mt-3 text-muted-foreground text-sm">
              Read directly from the business&apos;s pod (this bank&apos;s own DPoP-bound service
              identity) and verified through the real fail-closed <code>verifyCredential</code> gate
              chain — SHACL shape, validity window, Bitstring revocation status, and signature.
            </p>
          </li>
          <li className="rounded-lg border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-[0.15em]" style={{ color: "var(--primary)" }}>
              Beneficial-ownership completeness (ZK)
            </p>
            <p className="mt-2 font-semibold text-card-foreground">
              &ldquo;No undisclosed owner holds ≥25%&rdquo;
            </p>
            <p className="mt-3 text-muted-foreground text-sm">
              A real bank-minted single-use challenge, a real per-owner threshold proof, and a real
              completeness proof — verified against the issuer-anchored owner-array commitment read
              from the pod. A forged, tampered, replayed, or hidden-owner proof declines the
              account.
            </p>
          </li>
        </ul>
      </section>

      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            {BANK_ONBOARDING_APP.honesty.real.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            {BANK_ONBOARDING_APP.honesty.simulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
      />
    </main>
  );
}
