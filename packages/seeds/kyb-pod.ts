/**
 * Seed one business pod with Northwind Logistics LLC's full scripted persona layout
 * (design §5 scene 1 / §7) through `@jeswr/solid-seed`: the three real signed KYB
 * credentials, the Tier B beneficial-ownership array-commitment anchor (always real), the
 * Tier A per-owner threshold anchors (real when `SPARQ_CHECKOUT` is available, otherwise
 * honestly skipped — never fabricated), and the public-read issuer identity documents +
 * Bitstring status lists every verifier needs to check the signatures. This is the ONE
 * seeding path the seeder integration suite exercises.
 *
 * Every resource is issued/minted EAGERLY (before `seedPods` runs) rather than through
 * `@jeswr/solid-seed` resource expanders: none of this demo's credentials need a
 * cross-resource claim resolved mid-write (unlike the sibling lending seeder's
 * cash-flow-score `prov:wasDerivedFrom` edge), so the simpler static `PodLayout` is used
 * directly. Access control is entirely `@jeswr/solid-seed`'s own typed `AccessSpec` -> WAC
 * dataset builder (`buildAclDataset`) — this module never hand-builds or string-concatenates
 * an `.acl` document.
 */
import { type PodLayout, type ResourceSpec, type SeedTarget, seedPods } from "@jeswr/solid-seed";
import type { BeneficialOwnerValues, PersonaValues } from "@kyb/data-model";
import {
  northwindLogistics,
  scriptedCredentialSeeds,
  type ScriptedCredentialSeed,
} from "./credentials.ts";
import type {
  KybCredentialIssuance,
  KybIssuanceContext,
  SeededAnchorResource,
  TierAAnchorOutcome,
} from "./issuance.ts";
import { normalizedPodBase } from "./pod-base.ts";

/** Business-private: owner agent read/write/control only. */
const KYB_OWNER_ONLY_ACCESS = { publicRead: false } as const;
/** World-readable (plus full owner control): issuer identity documents, status lists and
 * the WebID profile card, which external verifiers must dereference anonymously. */
const KYB_PUBLIC_READ_ACCESS = { publicRead: true } as const;

function escapeTurtleLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** The WebID profile card: a public-facing pod resource (`foaf:name` + `pim:storage` +
 * the business's own LEI). The LEI is modelled as a FIBO identifier INDIVIDUAL
 * (`cmns-id:isIdentifiedBy` -> `fibo-be-le-lei:LegalEntityIdentifier`, value via
 * `cmns-txt:hasTextValue`) — the FIBO/Commons pattern — never a `schema:identifier`
 * string. */
function profileCardTurtle(options: {
  webid: string;
  name: string;
  identifier: string;
  storage: string;
}): string {
  return `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix schema: <https://schema.org/> .
@prefix cmns-id: <https://www.omg.org/spec/Commons/Identifiers/> .
@prefix cmns-txt: <https://www.omg.org/spec/Commons/TextDatatype/> .
@prefix fibo-be-le-lei: <https://spec.edmcouncil.org/fibo/ontology/BE/LegalEntities/LEIEntities/> .

<${options.webid}>
    a foaf:Person, schema:Organization, fibo-be-le-lei:LEIRegisteredEntity ;
    foaf:name "${escapeTurtleLiteral(options.name)}" ;
    cmns-id:isIdentifiedBy [
        a fibo-be-le-lei:LegalEntityIdentifier ;
        cmns-txt:hasTextValue "${escapeTurtleLiteral(options.identifier)}"
    ] ;
    pim:storage <${options.storage}> .
`;
}

export interface SeedKybPodOptions {
  /** The live pod (harness account or any Fetch-compatible target). */
  readonly target: SeedTarget;
  readonly issuance: KybCredentialIssuance;
  /** The demo reference instant — REQUIRED, never ambient. */
  readonly now: Date;
  /**
   * Write mode (solid-seed semantics): `create` strict-creates (the integration suite's
   * default — a doubly seeded pod is a harness bug), `ensure` converges a long-lived dev
   * pod, `replace` deterministically rewrites.
   */
  readonly mode?: "create" | "ensure" | "replace";
  /** Path of the WebID profile card. Defaults to `/profile/card`. */
  readonly profileCardPath?: string;
  /** Seed the WebID profile card. Default: only when the WebID lives on the pod origin. */
  readonly profileCard?: boolean;
}

export interface SeededKybPod {
  readonly manifest: Awaited<ReturnType<typeof seedPods>>;
  readonly persona: PersonaValues;
  readonly credentials: readonly ScriptedCredentialSeed[];
  readonly webid: string;
  readonly baseUrl: string;
  /** The Tier B (beneficial-ownership array-commitment) anchor — always genuinely minted. */
  readonly tierB: { readonly path: string; readonly arrayCommitment: string };
  /** The Tier A (per-owner threshold) anchor outcome — real when `SPARQ_CHECKOUT` was
   * available at seed time, honestly skipped (never fabricated) otherwise. */
  readonly tierA: TierAAnchorOutcome;
}

/** Seed the full Northwind Logistics LLC business-persona pod layout onto `options.target`. */
export async function seedKybPod(options: SeedKybPodOptions): Promise<SeededKybPod> {
  const persona = northwindLogistics();
  const credentials = scriptedCredentialSeeds(persona, options.now);

  const podBase = normalizedPodBase(options.target.baseUrl);
  const baseUrl = new URL(podBase);
  const origin = baseUrl.origin;
  // solid-seed resolves resource paths against the pod ORIGIN (its `SeedTarget.baseUrl`
  // must be an origin), so pod-BASE-relative paths are prefixed with the base's pathname
  // here and solid-seed receives the origin-rooted target — the storage-root path is never
  // discarded (same computation the sibling lending seeder's `layout.ts` performs).
  const pathPrefix = baseUrl.pathname === "/" ? "" : baseUrl.pathname.slice(0, -1);
  const podPath = (path: string): string => `${pathPrefix}${path}`;
  const context: KybIssuanceContext = {
    webid: options.target.webid,
    resolve: (path) => `${origin}${podPath(path)}`,
  };

  const webidUrl = new URL(options.target.webid);
  const resources: ResourceSpec[] = [];

  const wantsCard = options.profileCard ?? webidUrl.origin === origin;
  if (wantsCard) {
    if (webidUrl.origin !== origin) {
      throw new Error(
        `profileCard: WebID ${options.target.webid} is not on the pod origin ${origin} — its ` +
          "profile document cannot be seeded here",
      );
    }
    resources.push({
      path: options.profileCardPath ?? webidUrl.pathname,
      source: {
        body: profileCardTurtle({
          webid: options.target.webid,
          name: persona.businessName,
          identifier: persona.lei,
          storage: podBase,
        }),
      },
      contentType: "text/turtle",
      access: KYB_PUBLIC_READ_ACCESS,
    });
  }

  // Every credential + anchor is issued EAGERLY, in a fixed order, so status-list indices
  // never collide and the issuer resources captured below reflect every issuance.
  for (const spec of credentials) {
    const issued = await options.issuance.issue(spec, context);
    resources.push({
      path: podPath(spec.path),
      source: { body: issued.body },
      contentType: issued.contentType,
      access: KYB_OWNER_ONLY_ACCESS,
    });
  }

  const tierB = await options.issuance.mintTierBAnchor(persona.owners, context);
  resources.push(anchorResourceSpec(podPath, tierB.anchor));

  const tierA = await options.issuance.mintTierAAnchors(persona.owners, context);
  if (tierA.status === "minted") {
    for (const anchor of tierA.anchors) resources.push(anchorResourceSpec(podPath, anchor));
  }

  const issuerResources = await options.issuance.issuerResources();
  if (issuerResources.length === 0) {
    throw new Error("issuance returned no issuer resources — verification would fail closed");
  }
  for (const resource of issuerResources) {
    resources.push({
      path: podPath(resource.path),
      source: { body: resource.body },
      contentType: resource.contentType,
      access: KYB_PUBLIC_READ_ACCESS,
    });
  }

  const layout: PodLayout = {
    pods: [{ account: { target: { ...options.target, baseUrl: origin } }, resources }],
  };
  const manifest = await seedPods({ layout, mode: options.mode ?? "create" });

  return {
    manifest,
    persona,
    credentials,
    webid: options.target.webid,
    baseUrl: options.target.baseUrl,
    tierB: { path: tierB.anchor.path, arrayCommitment: tierB.arrayCommitment },
    tierA,
  };
}

function anchorResourceSpec(
  podPath: (path: string) => string,
  anchor: SeededAnchorResource,
): ResourceSpec {
  return {
    path: podPath(anchor.path),
    source: { body: anchor.body },
    contentType: anchor.contentType,
    access: KYB_OWNER_ONLY_ACCESS,
  };
}

export type { BeneficialOwnerValues };
