import { SurplusCallOutcome, SurplusClaimStatus, SurplusDeadReason, SurplusStage } from '@fast-homes/shared';

/**
 * The rules that move the course's four fields (Stage, Next action, Owner,
 * Due) without anybody typing them. Pure, so they are pinned by tests and
 * shared by the pull, the dialer and the inbox.
 */

/** Stages where a client has signed with us. The pull may never retire these. */
export const SIGNED_STAGES: readonly SurplusStage[] = [
  SurplusStage.AGREEMENT_SIGNED,
  SurplusStage.PACKAGE_NOTARIZED,
  SurplusStage.CLAIM_FILED,
  SurplusStage.AWAITING_DISBURSEMENT,
  SurplusStage.CHECK_RECEIVED,
  SurplusStage.PAID,
];

export function isSignedStage(stage: string | null | undefined): boolean {
  return !!stage && (SIGNED_STAGES as readonly string[]).includes(stage);
}

/** The follow-up task a mailed letter opens. A reply, or the envelope coming back, closes it. */
export const LETTER_REPLY_TASK_PREFIX = 'Check for a reply to the letter to ';

export type CountyRetirement =
  /** The docket says the money is gone and nobody has signed: retire, with the reason recorded. */
  | { action: 'retire'; data: { stage: SurplusStage; deadReason: SurplusDeadReason; deadNote: string; deadAt: Date } }
  /** A client has signed, so the docket's "assigned" is most likely our own filing. Leave the stage alone. */
  | { action: 'keep'; why: string }
  /** Already Dead, or still workable: nothing for the pull to do with the stage. */
  | { action: 'none' };

/**
 * What the weekly pull may do to a case's stage when the docket says the
 * claim is no longer workable. Before this, any non-workable docket set the
 * stage to Dead with no reason and no date, including a case we had filed
 * ourselves, whose own claim classifies as "assigned".
 */
export function countyRetirement(
  stage: string | null | undefined,
  claimStatus: string | null | undefined,
  workable: boolean,
  now = new Date(),
): CountyRetirement {
  if (workable) return { action: 'none' };
  if (stage === SurplusStage.DEAD) return { action: 'none' };
  if (isSignedStage(stage)) {
    return {
      action: 'keep',
      why: `County docket reads "${claimStatus || 'unknown'}" but the case is ${stage}, so it was not retired. Check that the filing on the docket is ours.`,
    };
  }
  const reason =
    claimStatus === SurplusClaimStatus.ASSIGNED ? SurplusDeadReason.ALREADY_ASSIGNED : SurplusDeadReason.PAID_OUT;
  return {
    action: 'retire',
    data: {
      stage: SurplusStage.DEAD,
      deadReason: reason,
      deadNote: `County docket: ${claimStatus || 'resolved'}.`,
      deadAt: now,
    },
  };
}

/**
 * A connected call where the person who can sign said no. Closes the case
 * with the reason, so Closed stops reading zero and the bad-leads list
 * exists. Null for every other outcome.
 */
export function outcomeDeadReason(outcome: string | null | undefined): SurplusDeadReason | null {
  switch (outcome) {
    case SurplusCallOutcome.NOT_INTERESTED:
      return SurplusDeadReason.NOT_INTERESTED;
    case SurplusCallOutcome.ALREADY_SIGNED:
      return SurplusDeadReason.ALREADY_ASSIGNED;
    default:
      return null;
  }
}
