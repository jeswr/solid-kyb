/** Build-time model helpers for the KYB residue vocabulary. */
import { Parser } from "n3";

export const KYB_NAMESPACE = "https://solid-kyb-vocab.vercel.app/kyb#";
export const KYB_ONTOLOGY_IRI = "https://solid-kyb-vocab.vercel.app/kyb";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
const RDFS_RANGE = "http://www.w3.org/2000/01/rdf-schema#range";
const RDFS_SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const SKOS_IN_SCHEME = "http://www.w3.org/2004/02/skos/core#inScheme";

const KIND_BY_TYPE = new Map([
  ["http://www.w3.org/2002/07/owl#Class", "Class"],
  ["http://www.w3.org/2002/07/owl#ObjectProperty", "Object property"],
  ["http://www.w3.org/2002/07/owl#DatatypeProperty", "Datatype property"],
  ["http://www.w3.org/2004/02/skos/core#ConceptScheme", "Concept scheme"],
  ["http://www.w3.org/2004/02/skos/core#Concept", "Concept"],
]);

export function parseVocab(turtle) {
  return new Parser({ format: "text/turtle" }).parse(turtle);
}

export function buildTermModel(quads) {
  const bySubject = new Map();
  for (const quad of quads) {
    const subject = quad.subject.value;
    if (quad.subject.termType !== "NamedNode" || !subject.startsWith(KYB_NAMESPACE)) continue;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject).push(quad);
  }

  const terms = [];
  for (const [iri, subjectQuads] of bySubject) {
    const objectValues = (predicate) =>
      subjectQuads
        .filter((quad) => quad.predicate.value === predicate)
        .map((quad) => quad.object.value);
    const types = objectValues(RDF_TYPE);
    const kind = types.map((type) => KIND_BY_TYPE.get(type)).find(Boolean) ?? "Term";
    terms.push({
      iri,
      localName: iri.slice(KYB_NAMESPACE.length),
      kind,
      label: objectValues(RDFS_LABEL)[0] ?? "",
      comment: objectValues(RDFS_COMMENT)[0] ?? "",
      range: objectValues(RDFS_RANGE)[0],
      subClassOf: objectValues(RDFS_SUBCLASS_OF)[0],
      inScheme: objectValues(SKOS_IN_SCHEME)[0],
      seeAlso: objectValues(RDFS_SEE_ALSO),
    });
  }

  const kindOrder = ["Class", "Object property", "Datatype property", "Concept scheme", "Concept"];
  terms.sort(
    (left, right) =>
      kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) ||
      left.localName.localeCompare(right.localName),
  );
  return terms;
}
