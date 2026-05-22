// Discriminator used by the comps pipeline to identify the owner of an analysis
// or a Comp row. Each Comp/CompAnalysis row has exactly one parent: either a
// Lead (the normal flow, lead-driven outreach) or a PropertyLookup (ad-hoc
// research without a Lead). The Prisma schema enforces this via a CHECK
// constraint; the helpers below let services write parent-agnostic queries.

export type CompParent =
  | { kind: 'lead'; leadId: string }
  | { kind: 'lookup'; lookupId: string };

/** Spread into a Prisma `create` data block for Comp or CompAnalysis. */
export function compParentCreate(p: CompParent): { leadId: string } | { propertyLookupId: string } {
  return p.kind === 'lead' ? { leadId: p.leadId } : { propertyLookupId: p.lookupId };
}

/** Spread into a Prisma `where` clause to scope by parent. */
export function compParentWhere(p: CompParent): { leadId: string } | { propertyLookupId: string } {
  return p.kind === 'lead' ? { leadId: p.leadId } : { propertyLookupId: p.lookupId };
}

export function isLeadParent(p: CompParent): p is { kind: 'lead'; leadId: string } {
  return p.kind === 'lead';
}

export function parentLabel(p: CompParent): string {
  return p.kind === 'lead' ? `lead ${p.leadId}` : `lookup ${p.lookupId}`;
}
