/**
 * The access-grant ODRL policy (design's grant/revoke requirement): a real W3C ODRL 2.2
 * document (`http://www.w3.org/ns/odrl/2/` — dereference-checked by `lint:iris`) recording,
 * as an inspectable policy rather than prose, that the business (assigner) permits a named
 * relying party (assignee) to `odrl:use` one specific credential (target).
 *
 * This is NOT a `@kyb/data-model` "KYB resource" (no SHACL shape ships for it — the
 * credential/VC layer does not know about ODRL policy documents), so it is built the same
 * way the lending/mortgage showcases' own wallet-authored ODRL/ACL documents are: through
 * `@rdfjs/wrapper` typed accessors directly, into a fresh `n3.Store`, serialised with the
 * house-sanctioned `@jeswr/rdf-serialize` (never hand-built triples, never
 * string-concatenated Turtle — house rule).
 *
 * Every grant/revoke transition ALSO writes the ordinary DPV consent receipt
 * (`./receipt.ts`) whose `odrl:target` names this same document's target credential — the
 * receipt is the auditable "who/when", this document is the auditable "under what terms".
 */
import { serialize } from "@jeswr/rdf-serialize";
import { RDF_TYPE, TURTLE_PREFIXES } from "@kyb/data-model";
import type { Quad, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  RequiredFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

const ODRL_NS = "http://www.w3.org/ns/odrl/2/";
const ODRL = {
  Agreement: `${ODRL_NS}Agreement`,
  Permission: `${ODRL_NS}Permission`,
  permission: `${ODRL_NS}permission`,
  assigner: `${ODRL_NS}assigner`,
  assignee: `${ODRL_NS}assignee`,
  action: `${ODRL_NS}action`,
  use: `${ODRL_NS}use`,
  target: `${ODRL_NS}target`,
} as const;

/** Real, dereferenceable Dublin Core term beyond what `@kyb/data-model`'s
 * `TURTLE_PREFIXES` binds. */
const DCTERMS_DESCRIPTION = "http://purl.org/dc/terms/description";

/** A plain typed-RDF node — this document is not a `@kyb/data-model` shape, so it has no
 * `TypedNode` base to extend; the same `@rdfjs/wrapper` primitives apply directly (house
 * rule: RDF only through typed accessors). */
class TypedTerm extends TermWrapper {}

/** `odrl:Permission` — the read action and its target credential. */
export class AccessPermission extends TypedTerm {
  get actionIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL.action, NamedNodeAs.string);
  }
  set actionIri(value: string) {
    RequiredAs.object(this, ODRL.action, value, NamedNodeFrom.string);
  }

  get targetIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL.target, NamedNodeAs.string);
  }
  set targetIri(value: string) {
    RequiredAs.object(this, ODRL.target, value, NamedNodeFrom.string);
  }
}

/** `odrl:Agreement` — the access-grant policy root. */
export class AccessGrantPolicy extends TypedTerm {
  get assignerIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL.assigner, NamedNodeAs.string);
  }
  set assignerIri(value: string) {
    RequiredAs.object(this, ODRL.assigner, value, NamedNodeFrom.string);
  }

  get assigneeIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL.assignee, NamedNodeAs.string);
  }
  set assigneeIri(value: string) {
    RequiredAs.object(this, ODRL.assignee, value, NamedNodeFrom.string);
  }

  get description(): string {
    return RequiredFrom.subjectPredicate(this, DCTERMS_DESCRIPTION, LiteralAs.string);
  }

  get permission(): AccessPermission {
    return RequiredFrom.subjectPredicate(this, ODRL.permission, TermAs.instance(AccessPermission));
  }
}

export interface AccessGrantPolicyInit {
  /** The document's own resource IRI. */
  readonly iri: string;
  /** The business WebID (holder, assigner). */
  readonly assigner: string;
  /** The relying party's service WebID (the party this policy authorizes). */
  readonly assignee: string;
  /** The credential pod resource this policy concerns. */
  readonly targetIri: string;
}

function link(parent: Term, dataset: Store, predicate: string, node: Term): void {
  RequiredAs.object(new TypedTerm(parent, dataset, DataFactory), predicate, node, TermFrom.itself);
}

/**
 * Build the access-grant ODRL document. Deterministic fragment IRI (not a blank node) for
 * the permission child node — this document is fully owned by the vault, so stable
 * addressability beats blank-node anonymity.
 */
export function buildAccessGrantPolicy(init: AccessGrantPolicyInit): {
  readonly resource: AccessGrantPolicy;
  readonly dataset: Store;
} {
  const dataset = new Store();
  const root = DataFactory.namedNode(init.iri);
  const permissionNode = DataFactory.namedNode(`${init.iri}#permission`);

  const resource = new AccessGrantPolicy(root, dataset, DataFactory);
  RequiredAs.object(resource, RDF_TYPE, ODRL.Agreement, NamedNodeFrom.string);
  resource.assignerIri = init.assigner;
  resource.assigneeIri = init.assignee;
  RequiredAs.object(
    resource,
    DCTERMS_DESCRIPTION,
    "The business permits this relying party to read one specific KYB credential; access is " +
      "granted and revoked exclusively through the vault's own WAC rewrite, never by editing " +
      "this document directly.",
    LiteralFrom.string,
  );
  link(root, dataset, ODRL.permission, permissionNode);

  const permission = new AccessPermission(permissionNode, dataset, DataFactory);
  RequiredAs.object(permission, RDF_TYPE, ODRL.Permission, NamedNodeFrom.string);
  permission.actionIri = ODRL.use;
  permission.targetIri = init.targetIri;

  return { resource, dataset };
}

export async function accessGrantPolicyToTurtle(dataset: Store): Promise<string> {
  return serialize([...dataset] as Quad[], {
    prefixes: { ...TURTLE_PREFIXES, dcterms: "http://purl.org/dc/terms/" },
  });
}
