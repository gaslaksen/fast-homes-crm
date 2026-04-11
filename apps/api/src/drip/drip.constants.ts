export const DRIP_QUEUE_NAME = 'drip-sequence';

export const CAMP_STEPS = [
  {
    key: 'hasTimeline',
    field: 'timeline',
    label: 'Priority (Timeline)',
    purpose:
      'Ask when they need to sell. Are they trying to move quickly or is there no rush? Keep it conversational.',
  },
  {
    key: 'hasAskingPrice',
    field: 'askingPrice',
    label: 'Money (Asking Price)',
    purpose:
      'Ask if they have a rough number in mind for the place. No pressure, just getting a ballpark.',
  },
  {
    key: 'hasCondition',
    field: 'conditionLevel',
    label: 'Challenge (Condition)',
    purpose:
      'Ask how the place is holding up. Anything major going on or is it in good shape? Keep it casual.',
  },
  {
    key: 'hasOwnership',
    field: 'ownershipStatus',
    label: 'Authority (Ownership)',
    purpose:
      'Ask if they are the only one on the deed or if someone else is involved too. Be respectful about it.',
  },
] as const;

export const DEFAULT_INITIAL_DELAY_MS = 60_000; // 1 minute after lead creation
export const DEFAULT_NEXT_QUESTION_DELAY_MS = 30_000; // 30 seconds after reply
export const DEFAULT_RETRY_DELAY_MS = 86_400_000; // 24 hours
export const DEFAULT_MAX_RETRIES = 2;

export const FALLBACK_MESSAGES: Record<string, string> = {
  hasTimeline:
    'Hi {name}, this is Dax. We just received your information about you looking to sell your house. How much are you asking for it? What are your timelines to sell?',
  hasAskingPrice:
    'Got it, thanks for that. Do you have a rough number in mind for the place?',
  hasCondition:
    'Ok great. How\'s the place holding up? Anything major going on with it?',
  hasOwnership:
    'Appreciate all that. One more thing, are you the only one on the deed or is someone else involved too?',
};
