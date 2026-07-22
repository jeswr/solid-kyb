/**
 * The vault's grant/revoke/ledger engine (design §5/§6 "grant/revoke a bank access to
 * specific credentials" + "a ledger of grants/revocations"), adapted from the small-dollar
 * lending showcase's wallet engine (`apps/wallet/lib/grants/engine.ts`,
 * jeswr/solid-lending — read-only reference; ISOMORPHIC state-machine pattern) to this
 * demo's READ-ONLY, credential-scoped grant model:
 *
 *   - "grant/revoke a bank access to specific credentials" (the brief) is literal here: a
 *     transition targets exactly ONE pod resource (`./resources.ts`'s three-credential
 *     catalogue), not a whole container, and grants READ ONLY (no bank ever writes into
 *     Northwind's vault in this build round — see the vault-owned CDD-decision-record
 *     follow-up note below).
 *
 *   - ACLs are REBUILT from per-agent single-agent rules: `#owner` (the business, full
 *     control), optional `#service` (the vault's Mode-2 service WebID), and one
 *     `#grant-…` rule per granted party, `acl:accessTo` only (these are plain resources,
 *     not containers — no `acl:default` needed).
 *
 *   - POLICY-BEARING receipts are UNFORGEABLE: the authoritative ledger lives in a
 *     DEDICATED `/kyb/receipts/` subcontainer whose OWN ACL grants write to the business +
 *     the vault's service identity ONLY (never any granted party). Grant/revoke POLICY
 *     reads run STRICT against that store (a transient dropout ABORTS the caller rather
 *     than silently shrinking history — a fail-open read would re-enable a revoked party).
 *
 *   - REVOCATION IS IMMUTABLE at the app level: once the protected store holds a withdraw
 *     receipt for (agent, resource), re-granting is refused (409). A REVOKE removes live
 *     WAC access BEFORE it touches the ledger, so nothing can block the business from
 *     cutting a party off.
 *
 *   - REPEAT operations are loud 409 no-ops (idempotent in effect).
 *
 *   - Fail-safe write ordering: REVOKE removes access, then records (a recording failure
 *     keeps access OFF and is retry-repairable); GRANT records after the ACL write and
 *     compensates surgically on receipt failure (re-checks whether a concurrent repair's
 *     DETERMINISTIC receipt already landed before rolling the ACL back).
 *
 *   - Each GRANT also idempotently writes an ODRL access-grant policy document
 *     (`./odrl.ts`) — the auditable "under what terms" beside the receipt's "who/when".
 *
 *   - KNOWN RESIDUAL (single-instance demo scope, tracked as a follow-up rather than
 *     silently built): a cross-instance create→lock race on the FIRST-EVER grant (an
 *     auto-scaling deploy racing to provision the receipts store) is not closed here — this
 *     app runs one instance in dev/test/demo. The pre-existing-store lock is still verified
 *     (never trusted blindly).
 *
 * RDF discipline: ACL documents through `@solid/object` typed wrappers, receipts through
 * `./receipt.ts`'s typed wrapper, the ODRL policy through `./odrl.ts`'s typed wrappers.
 * Serialisation only via `@jeswr/rdf-serialize`.
 */
import { serialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { AclResource, Authorization, ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import { accessGrantPolicyToTurtle, buildAccessGrantPolicy } from "./odrl";
import { PodAccessError, type PodIoFetch, readPodResource, writePodTurtle } from "./pod-io";
import { buildConsentReceipt, consentReceiptToTurtle, DPV, readConsentReceipt } from "./receipt";
import { type ResourceId, resourceIri } from "./resources";

export { PodAccessError } from "./pod-io";

const ACL = {
  Authorization: "http://www.w3.org/ns/auth/acl#Authorization",
  namespace: "http://www.w3.org/ns/auth/acl#",
} as const;

const RDF = { namespace: "http://www.w3.org/1999/02/22-rdf-syntax-ns#" } as const;

const RECEIPT_PREFIX = "consent-receipt-";
const RECEIPTS_SUBCONTAINER = "kyb/receipts/";
const VAULT_RECEIPT_PREFIX = "vault-";
const ACCESS_POLICIES_SUBCONTAINER = "kyb/access-policies/";

export interface ConsentReceiptView {
  readonly iri: string;
  readonly action: "grant" | "revoke";
  readonly actor: string;
  readonly recipient: string;
  readonly resource: string;
  readonly issuedAt: string;
  readonly provenance: "vault" | "external";
}

/** One (agent, resource) pair's current standing, for the dashboard. */
export interface GrantStanding {
  readonly agent: string;
  readonly resource: ResourceId;
  readonly granted: boolean;
  readonly revoked: boolean;
}

export interface GrantEngineOptions {
  /** Mode 2: the vault's DPoP-bound service identity. */
  readonly podFetch: PodIoFetch;
  /** Kept in every rebuilt ACL so the app never locks itself out. */
  readonly serviceWebId?: string;
  readonly now?: () => Date;
}

/** IN-PROCESS per-(pod,resource) serialization — see the module header's residual note. */
const transitionLocks = new Map<string, Promise<void>>();

function withTransitionLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = transitionLocks.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  transitionLocks.set(key, settled);
  void settled.then(() => {
    if (transitionLocks.get(key) === settled) transitionLocks.delete(key);
  });
  return next;
}

export function kybRootIri(podBase: string): string {
  return `${podBase}kyb/`;
}

export function receiptsContainerIri(podBase: string): string {
  return `${podBase}${RECEIPTS_SUBCONTAINER}`;
}

function accessPolicyIri(podBase: string, resource: ResourceId, party: string): string {
  return `${podBase}${ACCESS_POLICIES_SUBCONTAINER}${resource}-${encodeURIComponent(party)}`;
}

function aclIriFor(target: string): string {
  return `${target}.acl`;
}

/**
 * Idempotently provision the protected `/kyb/receipts/` store. Mirrors the lending/mortgage
 * showcases' `ensureReceiptsStore` (see module header for the dropped cross-instance
 * sentinel): a FRESH container is created then locked to owner (+ service) with
 * `acl:default` write; a PRE-EXISTING container is verify-only — its lock must grant
 * exactly owner (+service) member-covering write, nothing else, or the store is refused
 * (fail closed, never trusted).
 */
async function ensureReceiptsStore(
  podBase: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  podFetch: PodIoFetch,
): Promise<void> {
  const container = receiptsContainerIri(podBase);
  const iri = aclIriFor(container);
  const created = await podFetch(container, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: "",
    redirect: "error",
  });
  if (created.status === 412) {
    await verifyReceiptsLock(container, iri, ownerWebId, serviceWebId, podFetch);
    return;
  }
  if (!created.ok) {
    throw new PodAccessError(502, `could not provision the receipt store (${created.status})`);
  }
  const dataset = new Store();
  const owner = authorization(`${iri}#owner`, dataset, container, ownerWebId, true);
  owner.canRead = true;
  owner.canWrite = true;
  owner.canReadWriteAcl = true;
  if (serviceWebId !== undefined) {
    const service = authorization(`${iri}#service`, dataset, container, serviceWebId, true);
    service.canRead = true;
    service.canWrite = true;
    service.canReadWriteAcl = true;
  }
  const aclResponse = await podFetch(iri, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: await serializeAcl(dataset),
    redirect: "error",
  });
  if (aclResponse.ok) return;
  if (aclResponse.status === 412) {
    await verifyReceiptsLock(container, iri, ownerWebId, serviceWebId, podFetch);
    return;
  }
  throw new PodAccessError(502, `could not lock the receipt store (${aclResponse.status})`);
}

/**
 * Fail closed unless `/kyb/receipts/.acl` grants access to the business + vault service
 * ONLY — no public/authenticated class, no `acl:agentClass`, no `acl:agentGroup`, no other
 * `acl:agent`, every rule scoped to THIS container. Read through the `@solid/object` typed
 * wrappers (house rule).
 */
async function verifyReceiptsLock(
  containerIri: string,
  aclDocumentIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  podFetch: PodIoFetch,
): Promise<void> {
  const existing = await readPodResource(aclDocumentIri, containerIri, podFetch);
  if (existing === undefined) {
    throw new PodAccessError(
      409,
      "the consent-receipt store exists without its integrity lock — refusing to trust it; " +
        "reconcile it out of band before granting",
    );
  }
  const allowed = new Set([ownerWebId, ...(serviceWebId === undefined ? [] : [serviceWebId])]);
  const acl = new AclResource(new Store([...existing.dataset] as Quad[]), DataFactory);
  const untrusted = (detail: string): PodAccessError =>
    new PodAccessError(409, `the consent-receipt store lock is untrusted (${detail})`);
  let ownerCovered = false;
  let serviceCovered = serviceWebId === undefined;
  for (const rule of acl.authorizations) {
    if (rule.accessibleToAny || rule.accessibleToAuthenticated) {
      throw untrusted("grants public/authenticated access");
    }
    if (rule.agentClass.size > 0) throw untrusted("grants agentClass access");
    if (rule.agentGroup !== undefined) throw untrusted("grants agentGroup access");
    if (rule.accessTo !== undefined && rule.accessTo !== containerIri) {
      throw untrusted("names a foreign accessTo target");
    }
    if (rule.default !== undefined && rule.default !== containerIri) {
      throw untrusted("names a foreign default target");
    }
    if (rule.accessTo === undefined && rule.default === undefined) {
      throw untrusted("names no target");
    }
    for (const agent of rule.agent) {
      if (!allowed.has(agent)) throw untrusted("names an unexpected agent");
    }
    if (rule.default === containerIri && rule.canWrite) {
      if (rule.agent.has(ownerWebId)) ownerCovered = true;
      if (serviceWebId !== undefined && rule.agent.has(serviceWebId)) serviceCovered = true;
    }
  }
  if (!ownerCovered) throw untrusted("does not grant the business member-covering write");
  if (!serviceCovered) throw untrusted("does not grant the service member-covering write");
}

function authorization(
  iri: string,
  dataset: Store,
  target: string,
  agent: string,
  isContainer: boolean,
): Authorization {
  const rule = new Authorization(iri, dataset, DataFactory);
  rule.type.add(ACL.Authorization);
  rule.accessTo = target;
  // Container rules (the receipts store) additionally carry `acl:default` so members
  // inherit; plain-resource rules (every grantable credential) use `accessTo` alone.
  if (isContainer) rule.default = target;
  rule.agent.add(agent);
  return rule;
}

async function serializeAcl(dataset: Store): Promise<string> {
  return serialize([...dataset] as Quad[], {
    prefixes: { acl: ACL.namespace, rdf: RDF.namespace },
  });
}

interface AclSnapshot {
  readonly etag: string | null | undefined;
  readonly granted: ReadonlySet<string>;
}

async function readAclSnapshot(
  targetIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  podFetch: PodIoFetch,
): Promise<AclSnapshot> {
  const existing = await readPodResource(aclIriFor(targetIri), targetIri, podFetch);
  if (existing === undefined) return { etag: undefined, granted: new Set() };
  const acl = new AclResource(new Store([...existing.dataset] as Quad[]), DataFactory);
  const granted = new Set<string>();
  for (const rule of acl.authorizations) {
    if (rule.accessTo !== targetIri || !rule.canRead) continue;
    for (const agent of rule.agent) {
      if (agent === ownerWebId || agent === serviceWebId) continue;
      granted.add(agent);
    }
  }
  return { etag: existing.etag, granted };
}

async function writeAclDocument(
  targetIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  granted: ReadonlySet<string>,
  etag: string | null | undefined,
  podFetch: PodIoFetch,
): Promise<void> {
  const dataset = new Store();
  const iri = aclIriFor(targetIri);
  const owner = authorization(`${iri}#owner`, dataset, targetIri, ownerWebId, false);
  owner.canRead = true;
  owner.canWrite = true;
  owner.canReadWriteAcl = true;
  if (serviceWebId !== undefined) {
    const service = authorization(`${iri}#service`, dataset, targetIri, serviceWebId, false);
    service.canRead = true;
    service.canWrite = true;
    service.canReadWriteAcl = true;
  }
  for (const agent of [...granted].sort()) {
    const rule = authorization(
      `${iri}#grant-${encodeURIComponent(agent)}`,
      dataset,
      targetIri,
      agent,
      false,
    );
    rule.canRead = true;
  }
  await writePodTurtle(iri, await serializeAcl(dataset), { etag, podFetch });
}

async function removeAgentFromAcl(
  targetIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  agentWebId: string,
  podFetch: PodIoFetch,
): Promise<void> {
  const snapshot = await readAclSnapshot(targetIri, ownerWebId, serviceWebId, podFetch);
  if (!snapshot.granted.has(agentWebId)) return;
  const granted = new Set(snapshot.granted);
  granted.delete(agentWebId);
  await writeAclDocument(targetIri, ownerWebId, serviceWebId, granted, snapshot.etag, podFetch);
}

function receiptView(
  iri: string,
  receipt: ReturnType<typeof readConsentReceipt>,
  provenance: "vault" | "external" = "vault",
): ConsentReceiptView {
  const status = receipt.consentStatus;
  if (status !== DPV.ConsentGiven && status !== DPV.ConsentWithdrawn) {
    throw new PodAccessError(502, `receipt ${iri} has an unsupported consent status`);
  }
  return {
    iri,
    action: status === DPV.ConsentGiven ? "grant" : "revoke",
    actor: receipt.dataSubjectIri,
    recipient: receipt.dataControllerIri,
    resource: receipt.targetIri,
    issuedAt: receipt.issued.toISOString(),
    provenance,
  };
}

function receiptIriFor(
  podBase: string,
  resource: ResourceId,
  action: "grant" | "revoke",
  sequence: number,
  recipient: string,
): string {
  return `${receiptsContainerIri(podBase)}${VAULT_RECEIPT_PREFIX}${resource}-${sequence}-${action}-${encodeURIComponent(recipient)}`;
}

async function writeReceipt(
  podBase: string,
  actor: string,
  recipient: string,
  resource: ResourceId,
  targetIri: string,
  action: "grant" | "revoke",
  sequence: number,
  options: GrantEngineOptions,
): Promise<ConsentReceiptView> {
  const now = options.now?.() ?? new Date();
  const iri = receiptIriFor(podBase, resource, action, sequence, recipient);
  const { resource: receipt, dataset } = buildConsentReceipt({
    iri,
    dataSubject: actor,
    dataController: recipient,
    target: targetIri,
    consentStatus: action === "grant" ? DPV.ConsentGiven : DPV.ConsentWithdrawn,
    issued: now,
  });
  await writePodTurtle(iri, await consentReceiptToTurtle(dataset), {
    etag: undefined,
    podFetch: options.podFetch,
  });
  return receiptView(iri, receipt);
}

/** Idempotently write the ODRL access-grant policy document (once, on the first grant of
 * that (resource, party) pair — never rewritten on repair/retry). */
async function ensureAccessGrantPolicyDocument(
  podBase: string,
  businessWebId: string,
  partyWebId: string,
  resource: ResourceId,
  podFetch: PodIoFetch,
): Promise<void> {
  const iri = accessPolicyIri(podBase, resource, partyWebId);
  const { dataset } = buildAccessGrantPolicy({
    iri,
    assigner: businessWebId,
    assignee: partyWebId,
    targetIri: resourceIri(podBase, resource),
  });
  const response = await podFetch(iri, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: await accessGrantPolicyToTurtle(dataset),
    redirect: "error",
  });
  if (!response.ok && response.status !== 412) {
    throw new PodAccessError(
      502,
      `could not write the access-grant policy document (${response.status})`,
    );
  }
}

/**
 * Grant or revoke `agentWebId`'s READ access to ONE catalogue credential, with the matching
 * DPV receipt + ODRL policy document. State model in the module header.
 */
export function changeResourceAccess(
  podBase: string,
  businessWebId: string,
  agentWebId: string,
  resource: ResourceId,
  action: "grant" | "revoke",
  options: GrantEngineOptions,
): Promise<ConsentReceiptView> {
  return withTransitionLock(`${podBase} ${resource}`, () =>
    changeResourceAccessSerialized(podBase, businessWebId, agentWebId, resource, action, options),
  );
}

async function changeResourceAccessSerialized(
  podBase: string,
  businessWebId: string,
  agentWebId: string,
  resource: ResourceId,
  action: "grant" | "revoke",
  options: GrantEngineOptions,
): Promise<ConsentReceiptView> {
  const targetIri = resourceIri(podBase, resource);
  const snapshot = await readAclSnapshot(
    targetIri,
    businessWebId,
    options.serviceWebId,
    options.podFetch,
  );
  const isGranted = snapshot.granted.has(agentWebId);

  if (action === "revoke") {
    if (isGranted) {
      const granted = new Set(snapshot.granted);
      granted.delete(agentWebId);
      await writeAclDocument(
        targetIri,
        businessWebId,
        options.serviceWebId,
        granted,
        snapshot.etag,
        options.podFetch,
      );
    }
    await ensureReceiptsStore(podBase, businessWebId, options.serviceWebId, options.podFetch);
    const history = await policyHistoryFor(podBase, businessWebId, resource, agentWebId, options);
    const everRevoked = history.some((receipt) => receipt.action === "revoke");
    const everGranted = history.some((receipt) => receipt.action === "grant");
    if (!isGranted && everRevoked) {
      throw new PodAccessError(409, "access is already revoked and recorded");
    }
    if (!isGranted && !everGranted) {
      throw new PodAccessError(
        409,
        "no grant exists for this party, so there is nothing to revoke",
      );
    }
    return writeReceipt(
      podBase,
      businessWebId,
      agentWebId,
      resource,
      targetIri,
      "revoke",
      history.length,
      options,
    );
  }

  // action === "grant".
  await ensureReceiptsStore(podBase, businessWebId, options.serviceWebId, options.podFetch);
  const history = await policyHistoryFor(podBase, businessWebId, resource, agentWebId, options);
  const everRevoked = history.some((receipt) => receipt.action === "revoke");
  const everGranted = history.some((receipt) => receipt.action === "grant");

  if (everRevoked) {
    throw new PodAccessError(
      409,
      "revocation is immutable: this party's access was withdrawn by the business and is " +
        "never silently re-granted",
    );
  }
  if (isGranted && everGranted) {
    throw new PodAccessError(409, "access is already granted and recorded");
  }
  await ensureAccessGrantPolicyDocument(
    podBase,
    businessWebId,
    agentWebId,
    resource,
    options.podFetch,
  );
  if (!isGranted) {
    const granted = new Set(snapshot.granted);
    granted.add(agentWebId);
    await writeAclDocument(
      targetIri,
      businessWebId,
      options.serviceWebId,
      granted,
      snapshot.etag,
      options.podFetch,
    );
  }
  try {
    return await writeReceipt(
      podBase,
      businessWebId,
      agentWebId,
      resource,
      targetIri,
      "grant",
      history.length,
      options,
    );
  } catch (error) {
    if (!isGranted) {
      const transitionIri = receiptIriFor(podBase, resource, "grant", history.length, agentWebId);
      try {
        const recorded = await readPodResource(transitionIri, podBase, options.podFetch);
        if (recorded !== undefined) {
          const store = new Store([...recorded.dataset] as Quad[]);
          const view = receiptView(transitionIri, readConsentReceipt(transitionIri, store));
          if (
            view.action === "grant" &&
            view.actor === businessWebId &&
            view.recipient === agentWebId &&
            view.resource === targetIri
          ) {
            return view;
          }
        }
      } catch {
        // Could not tell — fall through to the fail-safe rollback below.
      }
      try {
        await removeAgentFromAcl(
          targetIri,
          businessWebId,
          options.serviceWebId,
          agentWebId,
          options.podFetch,
        );
      } catch {
        // Rollback failed too: applied-but-unrecorded; a retry lands the repair branch.
      }
    }
    throw error;
  }
}

async function policyHistoryFor(
  podBase: string,
  businessWebId: string,
  resource: ResourceId,
  agentWebId: string,
  options: GrantEngineOptions,
): Promise<readonly ConsentReceiptView[]> {
  const history = await readPolicyHistory(podBase, businessWebId, resource, options, true);
  return history.filter((receipt) => receipt.recipient === agentWebId);
}

/** The dashboard view: every (agent, resource) combination the catalogue permits that
 * currently holds a rule OR appears in the authoritative history. */
export async function readGrantStandings(
  podBase: string,
  businessWebId: string,
  resources: readonly ResourceId[],
  options: GrantEngineOptions,
): Promise<readonly GrantStanding[]> {
  const standings: GrantStanding[] = [];
  for (const resource of resources) {
    const targetIri = resourceIri(podBase, resource);
    const [history, snapshot] = await Promise.all([
      readPolicyHistory(podBase, businessWebId, resource, options),
      readAclSnapshot(targetIri, businessWebId, options.serviceWebId, options.podFetch),
    ]);
    const agents = new Set<string>(snapshot.granted);
    for (const receipt of history) agents.add(receipt.recipient);
    for (const agent of [...agents].sort()) {
      standings.push({
        agent,
        resource,
        granted: snapshot.granted.has(agent),
        revoked: history.some(
          (receipt) => receipt.recipient === agent && receipt.action === "revoke",
        ),
      });
    }
  }
  return standings;
}

async function readReceiptsFrom(
  listIri: string,
  prefixes: readonly string[],
  provenance: "vault" | "external",
  mode: "strict" | "tolerant",
  requireContainer: boolean,
  podBase: string,
  businessWebId: string,
  options: GrantEngineOptions,
): Promise<ConsentReceiptView[]> {
  const resource = await readPodResource(listIri, podBase, options.podFetch);
  if (resource === undefined) {
    if (requireContainer) {
      throw new PodAccessError(502, "the just-provisioned receipt store is unexpectedly absent");
    }
    return [];
  }
  const container = new ContainerDataset(resource.dataset, DataFactory).container;
  if (container === undefined) return [];
  const receiptIris = [...container.contains]
    .map((entry) => entry.value)
    .filter((iri) => prefixes.some((prefix) => iri.startsWith(`${listIri}${prefix}`)));
  const views = await Promise.all(
    receiptIris.map(async (iri): Promise<ConsentReceiptView | undefined> => {
      try {
        const stored = await readPodResource(iri, podBase, options.podFetch);
        if (stored === undefined) {
          if (mode === "strict") {
            throw new PodAccessError(502, `protected receipt ${iri} is listed but missing`);
          }
          return undefined;
        }
        const store = new Store([...stored.dataset] as Quad[]);
        const receipt = readConsentReceipt(iri, store);
        const view = receiptView(iri, receipt, provenance);
        if (view.actor !== businessWebId) {
          if (mode === "strict") {
            throw new PodAccessError(502, `protected receipt ${iri} names another data subject`);
          }
          return undefined;
        }
        return view;
      } catch (error) {
        if (mode === "strict") {
          throw error instanceof PodAccessError
            ? error
            : new PodAccessError(502, `protected receipt ${iri} could not be read`);
        }
        return undefined;
      }
    }),
  );
  return views.filter((view): view is ConsentReceiptView => view !== undefined);
}

async function readPolicyHistory(
  podBase: string,
  businessWebId: string,
  resource: ResourceId,
  options: GrantEngineOptions,
  requireStore = false,
): Promise<readonly ConsentReceiptView[]> {
  const listIri = receiptsContainerIri(podBase);
  const views = await readReceiptsFrom(
    listIri,
    [`${VAULT_RECEIPT_PREFIX}${resource}-`],
    "vault",
    "strict",
    requireStore,
    podBase,
    businessWebId,
    options,
  );
  const targetIri = resourceIri(podBase, resource);
  const prefix = `${VAULT_RECEIPT_PREFIX}${resource}-`;
  const authoritative = views.filter((view) => {
    if (view.resource !== targetIri) return false;
    const suffix = view.iri.slice(listIri.length);
    if (!suffix.startsWith(prefix)) return false;
    const rest = suffix.slice(prefix.length);
    const match = /^(\d+)-(grant|revoke)-(.+)$/.exec(rest);
    if (match === null) return false;
    const [, sequence, action, recipient] = match;
    return (
      action === view.action &&
      recipient === encodeURIComponent(view.recipient) &&
      view.iri === receiptIriFor(podBase, resource, view.action, Number(sequence), view.recipient)
    );
  });
  return authoritative.sort(
    (left, right) =>
      left.issuedAt.localeCompare(right.issuedAt) || left.iri.localeCompare(right.iri),
  );
}

/** The scene-6 DISPLAY ledger: the vault's authoritative `/kyb/receipts/` records PLUS any
 * root-level `/kyb/consent-receipt-…` written by other apps, all subject-checked,
 * time-ordered; untrusted/foreign entries are skipped rather than thrown. */
export async function readConsentLedger(
  podBase: string,
  businessWebId: string,
  options: GrantEngineOptions,
): Promise<readonly ConsentReceiptView[]> {
  const [vault, root] = await Promise.all([
    readReceiptsFrom(
      receiptsContainerIri(podBase),
      [VAULT_RECEIPT_PREFIX],
      "vault",
      "tolerant",
      false,
      podBase,
      businessWebId,
      options,
    ),
    readReceiptsFrom(
      kybRootIri(podBase),
      [RECEIPT_PREFIX],
      "external",
      "tolerant",
      false,
      podBase,
      businessWebId,
      options,
    ),
  ]);
  return [...vault, ...root].sort(
    (left, right) =>
      left.issuedAt.localeCompare(right.issuedAt) || left.iri.localeCompare(right.iri),
  );
}

export { RESOURCE_CATALOG, type ResourceId, resourceIri } from "./resources";
