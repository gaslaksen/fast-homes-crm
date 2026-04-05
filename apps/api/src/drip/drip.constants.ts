export const DRIP_QUEUE_NAME = 'drip-sequence';

export const CAMP_STEPS = [
  {
    key: 'hasTimeline',
    field: 'timeline',
    label: 'Priority (Timeline)',
    purpose:
      'Ask when they need to sell — are they trying to move quick or is there no rush? Keep it casual like a real text',
  },
  {
    key: 'hasAskingPrice',
    field: 'askingPrice',
    label: 'Money (Asking Price)',
    purpose:
      'Ask if they have a rough number in mind for the place. No pressure, just getting a ballpark',
  },
  {
    key: 'hasCondition',
    field: 'conditionLevel',
    label: 'Challenge (Condition)',
    purpose:
      'Ask how the place is holding up — anything major going on or is it in good shape? Keep it casual',
  },
  {
    key: 'hasOwnership',
    field: 'ownershipStatus',
    label: 'Authority (Ownership)',
    purpose:
      'Ask if they are the only one on the deed or if someone else is involved too. Be respectful about it',
  },
] as const;

export const DEFAULT_INITIAL_DELAY_MS = 60_000; // 1 minute after lead creation
export const DEFAULT_NEXT_QUESTION_DELAY_MS = 30_000; // 30 seconds after reply
export const DEFAULT_RETRY_DELAY_MS = 86_400_000; // 24 hours
export const DEFAULT_MAX_RETRIES = 2;

export const FALLBACK_MESSAGES: Record<string, string> = {
  hasTimeline:
    'hey {name}, got your request for {address}. you looking to sell soon or just seeing whats out there?',
  hasAskingPrice:
    'gotcha thanks for that. do you have a rough number in mind for the place',
  hasCondition:
    'nice ok so hows the place holding up? anything major going on with it',
  hasOwnership:
    'appreciate all that. one more thing are you the only one on the deed or is someone else involved too',
};
