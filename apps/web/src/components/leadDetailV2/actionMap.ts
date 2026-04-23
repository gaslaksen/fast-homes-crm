import type { ActionCategory } from '../ActionCard';

export type ActionIntent = 'reply' | 'offer' | 'follow-up' | 'camp' | 'contract' | 'call' | 'share' | 'sms';

export interface PrimaryAction {
  label: string;
  intent: ActionIntent;
  description?: string;
}

/**
 * Map Action Queue category → primary Action Bar button.
 * When the user arrives from an Action Queue item the deep-link intent takes
 * precedence; this function is the fallback when no intent is present.
 */
export function getPrimaryAction(lead: any, intent: string | null): PrimaryAction {
  if (intent) {
    switch (intent) {
      case 'reply': return { label: 'Send reply', intent: 'reply' };
      case 'offer': return { label: 'Send offer', intent: 'offer' };
      case 'follow-up': return { label: 'Schedule follow-up', intent: 'follow-up' };
      case 'contract': return { label: 'Open contract', intent: 'contract' };
      case 'call': return { label: 'Call seller', intent: 'call' };
      case 'share': return { label: 'Share with partners', intent: 'share' };
      case 'sms': return { label: 'Send SMS', intent: 'sms' };
      default:
        if (intent.startsWith('camp')) return { label: 'Ask CAMP question', intent: 'camp' };
    }
  }

  // Fallback: derive from lead state
  const tier = lead?.tier;
  const stage = lead?.status;
  const campComplete = lead?.campPriorityComplete && lead?.campMoneyComplete && lead?.campChallengeComplete && lead?.campAuthorityComplete;

  if (tier === 3 || stage === 'DEAD' || stage === 'CLOSED_LOST') {
    return { label: 'Send SMS', intent: 'sms' };
  }
  if (stage === 'UNDER_CONTRACT') return { label: 'Open contract', intent: 'contract' };
  if (stage === 'OFFER_MADE') return { label: 'Follow up on offer', intent: 'follow-up' };
  if (campComplete && lead?.arv) return { label: 'Send offer', intent: 'offer' };
  if (!campComplete) return { label: 'Ask CAMP question', intent: 'camp' };
  return { label: 'Send SMS', intent: 'sms' };
}

export function intentFromActionCategory(category: ActionCategory): ActionIntent {
  switch (category) {
    case 'NEEDS_REPLY':
    case 'DRIP_REPLY_REVIEW':
    case 'NEW_LEAD_INBOUND':
      return 'reply';
    case 'OFFER_READY':
      return 'offer';
    case 'FOLLOW_UP_DUE':
    case 'STALE_HOT_LEAD':
    case 'EXHAUSTED_LEAD':
      return 'follow-up';
    case 'CAMP_INCOMPLETE':
      return 'camp';
    case 'CONTRACT_PENDING':
      return 'contract';
    default:
      return 'reply';
  }
}
