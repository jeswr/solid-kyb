/**
 * The shared branded issuer-flow page (server component): role-first
 * framing, the PINNED demo-persona values the flow signs (marked
 * illustrative), what lands in the vault (credential + operand anchors +
 * status list), and the live issue panel. The layout-level
 * ConceptDemoBanner + AppShell cover every route already.
 */
import { IllustrativeFigure, StatCard } from "@jeswr/solid-showcase-kit";
import type { IssuerFlowId } from "../lib/server/config";
import {
  ARRAY_COMMITMENT_ANCHOR_PATH,
  ISSUER_FLOWS,
  OWNER_ANCHORS,
  PERSONA,
} from "../lib/server/flows";
import { IssuePanel } from "./issue-panel";

interface ClaimRow {
  readonly label: string;
  readonly value: string;
  /** Money/score/count figures carry the illustrative-figure qualifier. */
  readonly illustrative?: boolean;
}

function claimRows(flow: IssuerFlowId): ClaimRow[] {
  const definition = ISSUER_FLOWS[flow];
  const claims = definition.claims();
  switch (claims.kind) {
    case "org-identity-credential":
      return [
        { label: "Business name", value: claims.businessName },
        {
          label: "LEI (ISO 17442-shaped)",
          value: claims.lei,
        },
        { label: "Legal form", value: PERSONA.legalFormLocalName },
        {
          label: "Address",
          value: `${claims.address.streetAddress}, ${claims.address.addressLocality}, ${claims.address.addressRegion} ${claims.address.postalCode}`,
        },
      ];
    case "beneficial-ownership-credential":
      return claims.ownershipRecords.map((record) => ({
        illustrative: true,
        label: record.ownerName,
        value: `${record.ownershipPercentage}% (${record.ownershipPercentageBps} bps)`,
      }));
    case "officer-authorization-credential":
      return [
        { label: "Authorized officer", value: claims.officer.officerName },
        { label: "Job title", value: claims.officer.jobTitle },
      ];
    default:
      return [];
  }
}

export function FlowPage({ flow }: { flow: IssuerFlowId }) {
  const definition = ISSUER_FLOWS[flow];
  const rows = claimRows(flow);
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 pb-28"
      data-flow-page={flow}
    >
      <section>
        <p className="text-sm uppercase tracking-[0.2em]" style={{ color: "var(--primary)" }}>
          {definition.role}
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">{definition.label}</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Scene 1 — fill the vault. This issuer flow signs a{" "}
          <strong>W3C Verifiable Credential 2.0</strong> for the business and delivers it into its
          Data Vault pod through an authenticated Solid write — issued once, re-used with every bank
          the business will ever open an account at instead of re-submitting formation documents,
          EIN letters, or a cap table. Modelled on{" "}
          <IllustrativeFigure>{definition.modelledOn}</IllustrativeFigure>; simulated data only.
        </p>
      </section>

      <section aria-labelledby={`${flow}-claims`}>
        <h2 className="font-semibold text-xl" id={`${flow}-claims`}>
          What this flow attests
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <StatCard
              illustrative={row.illustrative}
              key={row.label}
              label={row.label}
              value={row.value}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby={`${flow}-lands`}>
        <h2 className="font-semibold text-xl" id={`${flow}-lands`}>
          What lands in the vault
        </h2>
        <ul className="mt-4 grid list-none gap-3 p-0 text-sm">
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Signed credential</strong> — <code>{definition.kind}</code> at{" "}
            <code>{definition.credentialPath}</code>, SHACL-validated before signing
            (eddsa-rdfc-2022), subject-bound to the authenticated business.
          </li>
          {definition.mintsAnchors ? (
            <>
              <li className="rounded-lg border border-border bg-card p-4">
                <strong>Tier B array-commitment anchor</strong> — the issuer-signed Blake3
                commitment over the full (hidden) owner array at{" "}
                <code>{ARRAY_COMMITMENT_ANCHOR_PATH}</code>, minted for real (pure JS, no native
                bridge needed) — the anchor the scene-3 completeness proof binds to.
              </li>
              <li className="rounded-lg border border-border bg-card p-4">
                <strong>Tier A per-owner anchors</strong> — not minted by this live app. One{" "}
                <code>kyb:ownershipPercentageBps</code> operand anchor per owner (
                {OWNER_ANCHORS.length} owners, reserved paths) needs the sparq native{" "}
                <code>encode_int_literal</code> bridge (<code>SPARQ_CHECKOUT</code>), which is
                Node-only and cannot run inside this serverless route — minted offline by an
                operator via <code>@kyb/vc-kit/seed-tooling</code> rather than fabricated here.
              </li>
            </>
          ) : (
            <li className="rounded-lg border border-border bg-card p-4">
              <strong>No ZK anchor</strong> — this field is disclosed at KYB, never proved by
              threshold; the scene-3 ZK statement is scoped to the beneficial-ownership flow's
              per-owner percentages only.
            </li>
          )}
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Bitstring status list</strong> — one revocation list per issuer flow. Status
            signals revocation only.
          </li>
        </ul>
      </section>

      <IssuePanel flow={flow} />
    </div>
  );
}
