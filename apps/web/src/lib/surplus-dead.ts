/**
 * Why a surplus claim was retired. Mirrors SurplusDeadReason in
 * packages/shared/src/types.ts; duplicated for the same reason as
 * surplus-calls.ts (Vercel builds the web app without the shared dist).
 * The API validates what this sends against the shared enum.
 */
export const SURPLUS_DEAD_REASONS: [string, string][] = [
  ['below_floor', 'Surplus below the floor'],
  ['deceased_no_heirs', 'Deceased, no heirs located'],
  ['competing_claim', 'Competing claim already filed'],
  ['unresponsive', 'Unresponsive after the set attempts'],
  ['already_assigned', 'Already signed with somebody else'],
  ['other', 'Other'],
];

export function deadReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return SURPLUS_DEAD_REASONS.find(([k]) => k === reason)?.[1] || reason;
}
