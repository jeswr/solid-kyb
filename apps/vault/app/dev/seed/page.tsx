"use client";

import { useState } from "react";

interface SeedResult {
  webid: string;
  resources: string[];
}

interface SeedError {
  error: string;
}

/**
 * Dev-only seed trigger: a browser button that POSTs `/api/dev/seed`, which seeds Northwind
 * Logistics LLC's REAL signed KYB-credential pod (`../../../lib/server/kyb-issuance.ts`).
 * Concept demonstration only; the fixed disclaimer banner from the root layout still
 * applies here.
 */
export default function DevSeedPage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SeedResult | SeedError | undefined>(undefined);

  async function seed() {
    setPending(true);
    setResult(undefined);
    try {
      const response = await fetch("/api/dev/seed", { method: "POST" });
      const body = (await response.json()) as SeedResult | SeedError;
      setResult(body);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Seed the demo persona</h1>
        <p className="mt-2 text-muted-foreground">
          Development only. Seeds Northwind Logistics LLC's real signed organisational-identity,
          beneficial-ownership, and officer-authorization credentials plus their ZK operand anchors
          into the pod named by <code>KYB_SEED_POD_URL</code> / <code>KYB_SEED_WEBID</code>.
        </p>
      </header>
      <button
        type="button"
        onClick={() => void seed()}
        disabled={pending}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending ? "Seeding…" : "Seed demo persona"}
      </button>
      {result !== undefined && (
        <pre className="overflow-x-auto rounded-md border bg-muted p-4 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
