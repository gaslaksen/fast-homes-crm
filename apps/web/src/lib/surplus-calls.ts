/**
 * Surplus call outcomes and objections, for the dialer's summary screen.
 *
 * Mirrors SurplusCallOutcome, SurplusObjection, their labels and the
 * follow-up rule in packages/shared/src/types.ts. Duplicated rather than
 * imported because Vercel builds the web app alone and the shared package has
 * no dist/ there, so a runtime import of @fast-homes/shared fails to resolve
 * (see strategy-config.ts for the same note). Keep the two in step: the API
 * validates what this file sends against the shared enum.
 */

export enum SurplusCallOutcome {
  NO_ANSWER_VOICEMAIL = 'no_answer_voicemail',
  NO_ANSWER = 'no_answer',
  SPOKE_CLAIMANT = 'spoke_claimant',
  SPOKE_RELATIVE = 'spoke_relative',
  WRONG_NUMBER = 'wrong_number',
  DISCONNECTED = 'disconnected',
  NOT_INTERESTED = 'not_interested',
  WANTS_PACKET = 'wants_packet',
  CALLBACK_SCHEDULED = 'callback_scheduled',
  ALREADY_SIGNED = 'already_signed',
  DO_NOT_CALL = 'do_not_call',
}

export const SURPLUS_CALL_OUTCOME_LABEL: Record<SurplusCallOutcome, string> = {
  [SurplusCallOutcome.NO_ANSWER_VOICEMAIL]: 'No answer, voicemail left',
  [SurplusCallOutcome.NO_ANSWER]: 'No answer',
  [SurplusCallOutcome.SPOKE_CLAIMANT]: 'Spoke to claimant',
  [SurplusCallOutcome.SPOKE_RELATIVE]: 'Spoke to relative, message passed',
  [SurplusCallOutcome.WRONG_NUMBER]: 'Wrong number',
  [SurplusCallOutcome.DISCONNECTED]: 'Disconnected',
  [SurplusCallOutcome.NOT_INTERESTED]: 'Not interested',
  [SurplusCallOutcome.WANTS_PACKET]: 'Wants the credibility packet',
  [SurplusCallOutcome.CALLBACK_SCHEDULED]: 'Callback scheduled',
  [SurplusCallOutcome.ALREADY_SIGNED]: 'Already signed elsewhere',
  [SurplusCallOutcome.DO_NOT_CALL]: 'Asked not to be called',
};

export enum SurplusObjection {
  WHO_ARE_YOU = 'who_are_you',
  ARE_YOU_REAL = 'are_you_real',
  COST = 'cost',
  TRUST = 'trust',
  TELL_ME_MORE = 'tell_me_more',
  OTHER = 'other',
}

export const SURPLUS_OBJECTION_LABEL: Record<SurplusObjection, string> = {
  [SurplusObjection.WHO_ARE_YOU]: 'Who are you?',
  [SurplusObjection.ARE_YOU_REAL]: 'Are you for real?',
  [SurplusObjection.COST]: 'What does it cost?',
  [SurplusObjection.TRUST]: 'Can I trust you?',
  [SurplusObjection.TELL_ME_MORE]: 'Tell me more first',
  [SurplusObjection.OTHER]: 'Something else',
};

/** Whether an outcome needs a dated follow-up before the call can be closed. */
export function surplusFollowUpRule(
  outcome: SurplusCallOutcome | string | null | undefined,
): 'required' | 'optional' | 'none' {
  switch (outcome) {
    case SurplusCallOutcome.CALLBACK_SCHEDULED:
    case SurplusCallOutcome.WANTS_PACKET:
    case SurplusCallOutcome.SPOKE_RELATIVE:
      return 'required';
    case SurplusCallOutcome.NO_ANSWER_VOICEMAIL:
    case SurplusCallOutcome.NO_ANSWER:
    case SurplusCallOutcome.SPOKE_CLAIMANT:
      return 'optional';
    default:
      return 'none';
  }
}

/** A person picked up. */
export function surplusCallConnected(outcome: SurplusCallOutcome | string | null | undefined): boolean {
  switch (outcome) {
    case SurplusCallOutcome.SPOKE_CLAIMANT:
    case SurplusCallOutcome.SPOKE_RELATIVE:
    case SurplusCallOutcome.NOT_INTERESTED:
    case SurplusCallOutcome.WANTS_PACKET:
    case SurplusCallOutcome.CALLBACK_SCHEDULED:
    case SurplusCallOutcome.ALREADY_SIGNED:
    case SurplusCallOutcome.DO_NOT_CALL:
      return true;
    default:
      return false;
  }
}
