export const DRIP_QUEUE_NAME = 'drip-sequence';

export const CAMP_STEPS = [
  {
    key: 'hasTimeline',
    field: 'timeline',
    label: 'Priority (Timeline)',
    purpose:
      'Ask when they need to sell — are they in a rush, or just exploring options? Be conversational.',
  },
  {
    key: 'hasAskingPrice',
    field: 'askingPrice',
    label: 'Money (Asking Price)',
    purpose:
      'Ask what price range they have in mind for the property. No pressure, just getting a ballpark.',
  },
  {
    key: 'hasCondition',
    field: 'conditionLevel',
    label: 'Challenge (Condition)',
    purpose:
      'Ask about the property condition — does it need work, or is it move-in ready? Keep it casual.',
  },
  {
    key: 'hasOwnership',
    field: 'ownershipStatus',
    label: 'Authority (Ownership)',
    purpose:
      'Ask whether they are the sole owner or if others are involved in the decision. Be respectful.',
  },
] as const;

export const DEFAULT_INITIAL_DELAY_MS = 60_000; // 1 minute after lead creation
export const DEFAULT_NEXT_QUESTION_DELAY_MS = 30_000; // 30 seconds after reply
export const DEFAULT_RETRY_DELAY_MS = 86_400_000; // 24 hours
export const DEFAULT_MAX_RETRIES = 2;

export const FALLBACK_MESSAGES: Record<string, string> = {
  hasTimeline:
    'Hi {name}, this is Fast Homes for Cash reaching out about {address}. Quick question — do you have a timeline in mind for selling? Reply STOP to opt out.',
  hasAskingPrice:
    'Thanks for the info! Do you have a ballpark price in mind for the property?',
  hasCondition:
    'Got it! How would you describe the condition of the property? Any major repairs needed?',
  hasOwnership:
    'Thanks! Last question — are you the sole owner of the property, or are there other decision-makers involved?',
};
