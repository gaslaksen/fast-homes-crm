/**
 * Search channels, cheapest first. Mirrors SurplusTraceChannel in
 * packages/shared/src/types.ts, duplicated for the same reason as
 * surplus-calls.ts (Vercel builds the web app without the shared dist).
 */
export const SURPLUS_TRACE_CHANNELS: [string, string][] = [
  ['free_search', 'Free search'],
  ['social', 'Social'],
  ['gov_records', 'Government records'],
  ['paid_db', 'Paid database'],
  ['pro_tracer', 'Professional tracer'],
  ['mail', 'Mail'],
];

export const SURPLUS_TIER1_CHANNELS = ['free_search', 'social', 'gov_records'];

export function traceChannelLabel(channel: string): string {
  return SURPLUS_TRACE_CHANNELS.find(([k]) => k === channel)?.[1] || channel;
}

/** Which channel a name-search site belongs to, for one-click logging. */
export function channelForSite(site: string): string {
  const s = site.toLowerCase();
  if (/facebook|linkedin|instagram/.test(s)) return 'social';
  if (/sunbiz|records|clerk|court|property appraiser|ssdi|census/.test(s)) return 'gov_records';
  if (/intelius|beenverified|peoplefinders|truepeople|spokeo|whitepages/.test(s)) return 'paid_db';
  return 'free_search';
}

export const TRACE_RESULTS: [string, string][] = [
  ['found', 'Found something'],
  ['nothing', 'Nothing'],
  ['mismatch', 'Wrong person'],
];
