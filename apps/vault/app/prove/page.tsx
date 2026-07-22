"use client";

import { HonestyPanel, StatCard } from "@jeswr/solid-showcase-kit";
import { useState } from "react";

interface TierResult {
  verified: boolean;
  errors: readonly { code: string; message: string }[];
  proveMs: number;
}

interface ProveResult {
  tierA?: TierResult;
  tierB?: TierResult;
  error?: string;
  detail?: string;
}

/**
 * Scene 3 "prove ownership without exposing the cap table": prove that a disclosed
 * beneficial owner's stake is >= the CDD Rule's 25% threshold (Tier A) and that the
 * disclosed owner set is complete — no undisclosed owner is hiding above the threshold
 * (Tier B) — without revealing the exact percentages. Real sparq UltraHonk proofs, checked
 * by the real fail-closed verifiers (`../../lib/server/zk-service.ts`).
 */
export default function ProvePage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProveResult | undefined>(undefined);

  async function proveAndVerify() {
    setPending(true);
    setResult(undefined);
    try {
      const challengeResponse = await fetch("/api/dev/prove/challenge", { method: "POST" });
      const challenge = (await challengeResponse.json()) as {
        tierA?: { sessionKey: string; nonce: string };
        tierB?: { sessionKey: string; nonce: string };
        error?: string;
        detail?: string;
      };
      if (!challengeResponse.ok || challenge.tierA === undefined || challenge.tierB === undefined) {
        setResult({ error: challenge.error, detail: challenge.detail });
        return;
      }
      const proveResponse = await fetch("/api/dev/prove/prove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tierA: challenge.tierA, tierB: challenge.tierB }),
      });
      const body = (await proveResponse.json()) as ProveResult;
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
        <h1 className="font-semibold text-2xl">Prove ownership without exposing the cap table</h1>
        <p className="mt-2 text-muted-foreground">
          Prove a disclosed owner&apos;s stake is at least 25% (Tier A) and that no undisclosed
          owner is hiding above that threshold (Tier B) — without revealing the exact percentages.
          Genuine sparq UltraHonk proofs, bound to single-use challenges, checked by the real
          fail-closed verifier chain.
        </p>
      </header>
      <button
        type="button"
        onClick={() => void proveAndVerify()}
        disabled={pending}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending ? "Proving (a few seconds)…" : "Prove ownership"}
      </button>
      {result?.error !== undefined && (
        <p className="text-destructive text-sm">
          {result.error}
          {result.detail !== undefined ? `: ${result.detail}` : ""}
        </p>
      )}
      {(result?.tierA !== undefined || result?.tierB !== undefined) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.tierA !== undefined && (
            <StatCard
              label="Tier A — per-owner threshold"
              value={result.tierA.verified ? "Verified" : "Not verified"}
              detail={`Proved + verified in ${Math.round(result.tierA.proveMs)} ms`}
            />
          )}
          {result.tierB !== undefined && (
            <StatCard
              label="Tier B — completeness"
              value={result.tierB.verified ? "Verified" : "Not verified"}
              detail={`Proved + verified in ${Math.round(result.tierB.proveMs)} ms`}
            />
          )}
        </div>
      )}
      {result?.tierA !== undefined && result.tierA.errors.length > 0 && (
        <ul className="list-disc pl-5 text-destructive text-xs">
          {result.tierA.errors.map((error) => (
            <li key={error.code}>
              Tier A — {error.code}: {error.message}
            </li>
          ))}
        </ul>
      )}
      {result?.tierB !== undefined && result.tierB.errors.length > 0 && (
        <ul className="list-disc pl-5 text-destructive text-xs">
          {result.tierB.errors.map((error) => (
            <li key={error.code}>
              Tier B — {error.code}: {error.message}
            </li>
          ))}
        </ul>
      )}
      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              Both proofs are genuinely computed by sparq's UltraHonk prover over your seeded
              operand anchors, and checked by the real nine-gate fail-closed verifiers — nothing
              here is mocked.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              This scaffold has no in-browser WASM runtime yet, so proving runs server-side in this
              dev environment rather than literally inside your browser tab; there is no live bank
              rail in this repo yet to send the proof to, so this route also stands in as the
              verifier. Tier A's anchor is a genuine captured sparq encoding standing in for an
              exact persona value, disclosed in `lib/server/kyb-issuance.ts`'s header — minting a
              live encoding for Jordan's or Priya's exact stake needs a local sparq checkout this
              environment does not have. The completeness circuit (Tier B) is this project's own
              bespoke, unaudited research artifact.
            </li>
          </ul>
        }
      />
    </main>
  );
}
