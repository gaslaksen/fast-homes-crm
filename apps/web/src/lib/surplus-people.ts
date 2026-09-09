/**
 * Who a person on a claim is, and where the outreach to them stands.
 * Mirrors SurplusPersonRole and SurplusContactStatus in
 * packages/shared/src/types.ts, duplicated for the same reason as
 * surplus-calls.ts (Vercel builds the web app without the shared dist).
 */
export const SURPLUS_PERSON_ROLES: [string, string][] = [
  ['heir', 'Heir'],
  ['relative', 'Relative'],
  ['neighbor', 'Neighbor'],
  ['friend', 'Friend'],
  ['associate', 'Associate'],
];

export const SURPLUS_CONTACT_STATUSES: [string, string][] = [
  ['not_contacted', 'Not contacted'],
  ['contacted', 'Contacted'],
  ['message_passed', 'Passed a message on'],
  ['dead_end', 'Dead end'],
];

export function personRoleLabel(role: string): string {
  return SURPLUS_PERSON_ROLES.find(([k]) => k === role)?.[1] || role;
}

export function contactStatusLabel(status: string): string {
  return SURPLUS_CONTACT_STATUSES.find(([k]) => k === status)?.[1] || status;
}
