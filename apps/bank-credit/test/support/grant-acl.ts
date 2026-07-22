/**
 * Test-only WAC ACL templates for the scene-3/4 grant (decision-0015-style
 * L4): a REAL access-control document naming exactly the service identity
 * this desk's grant permits, mirroring `@kyb/test-kit`'s own `publicReadAcl`
 * (which grants `foaf:Agent` instead of a specific WebID). Ported from the
 * small-dollar-lending showcase's `apps/bank-lender/test/grant-acl.ts`
 * (jeswr/solid-lending, read-only reference).
 */

/** A resource-scoped ACL: the owner keeps full control; `agentWebid` gets Read only. */
export function resourceGrantAcl(
  resourcePath: string,
  options: { ownerWebid: string; agentWebid: string },
): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${options.ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .

<#grant>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${options.agentWebid}> ;
    acl:mode acl:Read .
`;
}

/** A resource-scoped ACL with NO grant beyond the owner (revocation state). */
export function ownerOnlyAcl(resourcePath: string, ownerWebid: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
`;
}

/**
 * Grant `agentWebid` Read+Write over the WHOLE `containerPath` via
 * `acl:default` inheritance — new-resource creation (the CDD decision
 * record this desk writes at runtime) is authorized against the NEAREST
 * container's effective ACL, since the target resource does not exist yet
 * and so carries no resource-level ACL of its own.
 */
export function containerGrantAcl(
  containerPath: string,
  options: { ownerWebid: string; agentWebid: string },
): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agent <${options.ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .

<#grant>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agent <${options.agentWebid}> ;
    acl:mode acl:Read, acl:Write .
`;
}

/** A container-scoped ACL with NO grant beyond the owner (revocation state), still `acl:default`-inheriting so the removal reaches every resource under it that has no closer ACL of its own. */
export function ownerOnlyContainerAcl(containerPath: string, ownerWebid: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agent <${ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
`;
}
