"use client";

/**
 * The live decision panel: calls this desk's decision rail (`/api/decision`),
 * which requires a REAL DPoP-bound Solid-OIDC session and a business grant
 * naming this app's service identity over the org-identity + beneficial-
 * ownership credentials already in the vault. Without one the rail answers
 * 401/503/403 and this panel says so honestly — it never fakes a decision,
 * and it never re-asks for any information the business already disclosed
 * to `issuers` — that is the whole point of this scene.
 */
import { useCallback, useState } from "react";
import { BASE_PATH } from "../lib/paths";

interface Finding {
  code: string;
  rule: string;
  pass: boolean;
  observed: string;
}

interface Decision {
  outcome: "approve" | "decline";
  findings: Finding[];
  reasons: string[];
}

interface DisclosedOwner {
  ownerName: string;
  ownershipPercentage: number;
}

interface Claims {
  businessName: string;
  lei: string;
  legalForm: string;
  owners: DisclosedOwner[];
}

interface DecisionResult {
  simulated?: boolean;
  decision?: Decision;
  claims?: Claims | null;
  decisionIri?: string;
  evaluatedAt?: string;
  error?: string;
  detail?: string;
}

type PanelState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; result: DecisionResult }
  | { phase: "failed"; status: number; result: DecisionResult };

export function DecisionPanel() {
  const [state, setState] = useState<PanelState>({ phase: "idle" });

  const decide = useCallback(async () => {
    setState({ phase: "busy" });
    try {
      const response = await fetch(`${BASE_PATH}/api/decision`, { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as DecisionResult;
      setState(
        response.ok
          ? { phase: "done", result }
          : { phase: "failed", result, status: response.status },
      );
    } catch {
      setState({ phase: "failed", result: {}, status: 0 });
    }
  }, []);

  return (
    <section
      aria-labelledby="decision-panel"
      className="rounded-lg border border-border bg-card p-6"
    >
      <h2 className="font-semibold text-xl" id="decision-panel">
        Reuse the vault, decide the line of credit
      </h2>
      <p className="mt-2 text-muted-foreground text-sm">
        Reads the SAME organisational-identity and beneficial-ownership credentials already in your
        Data Vault pod — nothing is re-typed here. Requires a real DPoP-bound Solid-OIDC session and
        a vault grant naming this desk's service identity.
      </p>
      <div className="mt-4">
        <button
          className="rounded-md px-4 py-2 font-medium text-sm disabled:opacity-60"
          disabled={state.phase === "busy"}
          onClick={() => void decide()}
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          type="button"
        >
          {state.phase === "busy" ? "Deciding…" : "Run the credit decision"}
        </button>
      </div>
      <div aria-live="polite" className="mt-4 text-sm">
        {state.phase === "done" && state.result.decision !== undefined && (
          <div className="flex flex-col gap-3" data-panel-outcome={state.result.decision.outcome}>
            <p className="font-semibold">
              Outcome:{" "}
              <span
                style={{
                  color: state.result.decision.outcome === "approve" ? "var(--primary)" : undefined,
                }}
              >
                {state.result.decision.outcome === "approve" ? "Line of credit opened" : "Declined"}
              </span>
            </p>
            {state.result.claims != null && (
              <div className="rounded-md border border-border p-3 text-xs">
                <p>
                  <strong>Reused, not re-collected</strong> — the same disclosed values from your
                  vault:
                </p>
                <ul className="mt-2 list-disc pl-5">
                  <li>
                    {state.result.claims.businessName} ({state.result.claims.lei})
                  </li>
                  {state.result.claims.owners.map((owner) => (
                    <li key={owner.ownerName}>
                      {owner.ownerName} — {owner.ownershipPercentage}%
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="list-none pl-0 text-xs">
              {state.result.decision.findings.map((finding) => (
                <li className="mt-1" key={finding.code}>
                  {finding.pass ? "✓" : "✗"} {finding.observed}
                </li>
              ))}
            </ul>
            {state.result.decision.reasons.length > 0 && (
              <p className="text-muted-foreground">
                Reasons: {state.result.decision.reasons.join("; ")}
              </p>
            )}
            {state.result.decisionIri != null && (
              <p className="text-muted-foreground">
                Decision record: <code>{state.result.decisionIri}</code>
              </p>
            )}
          </div>
        )}
        {state.phase === "failed" && (
          <p className="text-muted-foreground" data-panel-outcome="failed">
            {state.status === 401
              ? "Not signed in: this rail requires a real DPoP-bound Solid-OIDC session. Nothing was decided — this demo never fakes a success."
              : state.status === 403
                ? "Access denied: your vault has not granted this desk's service identity access to your credentials. Nothing was re-collected — this demo never falls back to asking you to re-type it."
                : `The rail refused the request (${state.status || "network error"}${
                    state.result.error !== undefined ? `: ${state.result.error}` : ""
                  }). ${state.result.detail ?? ""}`}
          </p>
        )}
      </div>
    </section>
  );
}
