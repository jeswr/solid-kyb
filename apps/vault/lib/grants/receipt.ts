/**
 * The consent-receipt document (design §6 "DPV consent receipts"): a real, dereferenceable
 * DPV (Data Privacy Vocabulary, `https://w3id.org/dpv#`) record of one grant or revocation
 * transition. Real terms only (verified against the published DPV Turtle,
 * `https://w3id.org/dpv#`, 2026-07-22): `dpv:ConsentReceipt`, `dpv:ConsentGiven`,
 * `dpv:ConsentWithdrawn`, `dpv:hasConsentStatus`, `dpv:hasDataSubject`,
 * `dpv:hasDataController`; `odrl:target` (already used by `./odrl.ts`) names the concerned
 * credential; `dcterms:issued` carries the timestamp.
 *
 * This is NOT a `@kyb/data-model` shape (no SHACL ships for it), so it is built the same
 * way `./odrl.ts` is: through `@rdfjs/wrapper` typed accessors directly, serialised with the
 * house-sanctioned `@jeswr/rdf-serialize` — never hand-built triples.
 */
import { serialize } from "@jeswr/rdf-serialize";
import { RDF_TYPE, TURTLE_PREFIXES } from "@kyb/data-model";
import type { Quad } from "@rdfjs/types";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  RequiredFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

const DPV_NS = "https://w3id.org/dpv#";
const ODRL_NS = "http://www.w3.org/ns/odrl/2/";
const DCTERMS_NS = "http://purl.org/dc/terms/";

export const DPV = {
  ConsentReceipt: `${DPV_NS}ConsentReceipt`,
  ConsentGiven: `${DPV_NS}ConsentGiven`,
  ConsentWithdrawn: `${DPV_NS}ConsentWithdrawn`,
  hasConsentStatus: `${DPV_NS}hasConsentStatus`,
  hasDataSubject: `${DPV_NS}hasDataSubject`,
  hasDataController: `${DPV_NS}hasDataController`,
} as const;

const ODRL_TARGET = `${ODRL_NS}target`;
const DCTERMS_ISSUED = `${DCTERMS_NS}issued`;

class TypedTerm extends TermWrapper {}

/** One DPV consent-receipt document (`dpv:ConsentReceipt`). */
export class ConsentReceipt extends TypedTerm {
  get consentStatus(): string {
    return RequiredFrom.subjectPredicate(this, DPV.hasConsentStatus, NamedNodeAs.string);
  }
  set consentStatus(value: string) {
    RequiredAs.object(this, DPV.hasConsentStatus, value, NamedNodeFrom.string);
  }

  /** The business WebID (the data subject giving/withdrawing consent). */
  get dataSubjectIri(): string {
    return RequiredFrom.subjectPredicate(this, DPV.hasDataSubject, NamedNodeAs.string);
  }
  set dataSubjectIri(value: string) {
    RequiredAs.object(this, DPV.hasDataSubject, value, NamedNodeFrom.string);
  }

  /** The relying party's service WebID (the data controller the consent concerns). */
  get dataControllerIri(): string {
    return RequiredFrom.subjectPredicate(this, DPV.hasDataController, NamedNodeAs.string);
  }
  set dataControllerIri(value: string) {
    RequiredAs.object(this, DPV.hasDataController, value, NamedNodeFrom.string);
  }

  /** The credential pod resource this consent concerns. */
  get targetIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL_TARGET, NamedNodeAs.string);
  }
  set targetIri(value: string) {
    RequiredAs.object(this, ODRL_TARGET, value, NamedNodeFrom.string);
  }

  get issued(): Date {
    return RequiredFrom.subjectPredicate(this, DCTERMS_ISSUED, (term) => new Date(term.value));
  }
  set issued(value: Date) {
    RequiredAs.object(this, DCTERMS_ISSUED, value, LiteralFrom.dateTime);
  }
}

export interface ConsentReceiptInit {
  readonly iri: string;
  readonly dataSubject: string;
  readonly dataController: string;
  readonly target: string;
  readonly consentStatus: string;
  readonly issued: Date;
}

/** Build one consent-receipt document. */
export function buildConsentReceipt(init: ConsentReceiptInit): {
  readonly resource: ConsentReceipt;
  readonly dataset: Store;
} {
  const dataset = new Store();
  const root = DataFactory.namedNode(init.iri);
  const resource = new ConsentReceipt(root, dataset, DataFactory);
  RequiredAs.object(resource, RDF_TYPE, DPV.ConsentReceipt, NamedNodeFrom.string);
  resource.consentStatus = init.consentStatus;
  resource.dataSubjectIri = init.dataSubject;
  resource.dataControllerIri = init.dataController;
  resource.targetIri = init.target;
  resource.issued = init.issued;
  return { resource, dataset };
}

/** Read back an already-fetched consent-receipt dataset, structurally (no SHACL shape
 * exists for this app-owned document kind — the accessors themselves throw on
 * malformation). */
export function readConsentReceipt(iri: string, dataset: Store): ConsentReceipt {
  return new ConsentReceipt(DataFactory.namedNode(iri), dataset, DataFactory);
}

export async function consentReceiptToTurtle(dataset: Store): Promise<string> {
  // `@kyb/data-model`'s TURTLE_PREFIXES already binds "dpv" to this same namespace.
  return serialize([...dataset] as Quad[], {
    prefixes: { ...TURTLE_PREFIXES, dcterms: DCTERMS_NS },
  });
}
