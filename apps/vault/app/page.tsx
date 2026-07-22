import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { app } from "../lib/walkthrough";

const SURFACES = [
  {
    href: "/dev/seed",
    title: "Seed the demo persona",
    description: "Write Northwind Logistics LLC's signed KYB credentials into the vault (scene 1).",
  },
  {
    href: "/credentials",
    title: "Credentials",
    description: "The three verifiable credentials in the vault, verified on view.",
  },
  {
    href: "/prove",
    title: "Prove ownership (ZK)",
    description: "A real Tier A + Tier B zero-knowledge proof of beneficial ownership (scene 3).",
  },
  {
    href: "/grants",
    title: "Access grants",
    description: "Grant or revoke a bank's access to one credential (scenes 2, 4, 6).",
  },
  {
    href: "/ledger",
    title: "Consent-receipt ledger",
    description: "Every grant and revocation, receipted and time-ordered (scene 6).",
  },
] as const;

/**
 * The vault's home: role-first framing (design §6.1) plus links to every scene surface. Its
 * name, theme, and honesty content come from the registry entry in `content/walkthrough.json`.
 */
export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">{app.appName}</h1>
        <p className="mt-2 text-muted-foreground">
          Northwind Logistics LLC's business-controlled data vault, modelled on {app.modelledOn}.
          Its organisational-identity, beneficial-ownership, and officer-authorization credentials
          live here, only the business controls — every bank gets scoped, receipted, revocable
          access, and it can prove beneficial ownership without disclosing the underlying cap table.
        </p>
      </header>
      <nav className="grid gap-4 sm:grid-cols-2">
        {SURFACES.map((surface) => (
          <Link
            key={surface.href}
            href={surface.href}
            className="rounded-md border p-4 transition hover:bg-muted"
          >
            <h2 className="font-medium">{surface.title}</h2>
            <p className="mt-1 text-muted-foreground text-sm">{surface.description}</p>
          </Link>
        ))}
      </nav>
      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            {honesty.real.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            {honesty.simulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
      />
    </main>
  );
}
