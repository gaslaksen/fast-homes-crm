import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Surplus funds claims, as the API's SurplusService.toRow() shapes them.
 *
 * A surplus lead is a FORMER owner with money already sitting at a clerk, so
 * none of the wholesaling fields (ARV, repairs, CAMP) mean anything on it. All
 * of the claim lives on GET /surplus/:id; GET /leads/:id carries none of it.
 * Only the fields the app reads are typed here.
 */

export interface SurplusLien {
  type: string;
  holder: string;
  amount: number;
  governmental?: boolean;
}

export interface SurplusPhone {
  number: string;
  type: string | null;
  /** 'federal' | 'state' | 'litigator' | 'tcpa' when the number is on a registry. */
  dnc: string | null;
}

export interface SurplusHeir {
  id: string;
  name: string;
  roleLabel: string;
  isHeir: boolean;
  relationship: string | null;
  share: string | number | null;
  address: string | null;
  deceased: boolean;
  phones: SurplusPhone[];
  emails: string[];
  callable: boolean;
  doNotCall: boolean;
  contactStatusLabel: string;
}

export interface SurplusDocument {
  kind: string;
  label: string;
  status: string;
  statusLabel: string;
  collected: boolean;
  required: boolean;
}

export interface SurplusLetter {
  id: string;
  mailedAt: string;
  recipientName: string | null;
  address: string | null;
  mailType: string;
}

export interface SurplusRow {
  id: string;
  claimant: string;
  claimantType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  caseNumber: string | null;
  parcelId: string | null;
  courtRecordsUrl: string | null;

  deceased: boolean;
  heirsRequired: boolean;
  isDeceased: boolean;
  dateOfDeath: string | null;
  deathSource: string | null;
  obituaryMatch: string | null;
  competingLien: boolean;

  surplusType: string | null;
  fundLocation: string | null;
  stage: string | null;
  tier: string;

  saleDate: string | null;
  daysSinceSale: number | null;
  salePrice: number | null;
  noticeDate: string | null;
  noticeConfirmed: boolean;
  noticeAge: number | null;
  claimDeadline: string | null;
  daysRemaining: number | null;

  grossSurplus: number;
  liens: SurplusLien[];
  totalLiens: number;
  netToClaimant: number;
  estFee: number;

  entitlementVerified: boolean;
  titleSearchComplete: boolean;
  documents: SurplusDocument[];
  docsMissing: string[];
  docsComplete: boolean;
  /** What each gated stage still needs, keyed by stage. Empty array = clear. */
  stageBlocks: Record<string, string[]>;
  compliance: { clear: boolean; blocks: string[]; warns: string[] };

  claimStatus: string;
  claimStatusLabel: string;
  surplusAtNotice: number | null;
  noticeRecipient: string | null;
  ownerMailingStreet: string | null;
  ownerMailingCity: string | null;
  ownerMailingState: string | null;
  ownerMailingZip: string | null;
  mailVerdict: string | null;
  sourceUrl: string | null;

  phones: SurplusPhone[];
  emails: string[];
  cleanPhoneCount: number;
  contactMismatch: boolean;
  mismatchedName: string | null;

  heirs: SurplusHeir[];
  doNotCall: boolean;
  letters: SurplusLetter[];
  letterCount: number;
  letterDueAt: string | null;
  letterDue: boolean;

  touches: number;
  lastTouchedAt: string | null;
  tappedAt: string | null;
  contactStatus: 'not_tapped' | 'tapped' | 'recap_scheduled';

  /** What "unresponsive" still needs before it can be a reason for Dead. */
  deadGateMissing: string[];
  deadReasonLabel: string | null;
  deadNote: string | null;

  nextTask: { id: string; title: string; dueDate: string | null } | null;
  overdueTaskCount: number;

  workScore: number;
  workReason: string | null;
  queue: string;
  queueLabel: string;
  queueReason: string | null;
}

export interface SurplusStats {
  openClaims: number;
  claimantCount: number;
  newSevenDays: number;
  tierA: number;
  queues: Record<string, number>;
  netInPipeline: number;
  notTapped: number;
  missingChannel: number;
  letterDue: number;
  updateOverdue: number;
}

/** One claim. Shares its cache entry with the list rows that open it. */
export function useSurplus(leadId: string, enabled = true) {
  return useQuery({
    queryKey: ['surplus', leadId],
    queryFn: async () => (await api.get<SurplusRow>(`/surplus/${leadId}`)).data,
    enabled: !!leadId && enabled,
  });
}

export function useSurplusStats() {
  return useQuery({
    queryKey: ['surplus', 'stats'],
    queryFn: async () => (await api.get<SurplusStats>('/surplus/stats')).data,
    staleTime: 60_000,
  });
}

export interface SurplusListParams {
  search?: string;
  queue?: string;
  contact?: string;
  letterDue?: string;
  sort?: string;
}

const PAGE_SIZE = 40;

/**
 * The work list, one row per claimant (group=lead) rather than per property,
 * since the app opens a person, not a case. Ranked by the API's work score
 * unless another sort is asked for. Dead claims are left off: they are the
 * web board's to review.
 */
export function useSurplusList(params: SurplusListParams) {
  return useInfiniteQuery({
    queryKey: ['surplus', 'list', params],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<{ data: SurplusRow[]; total: number; page: number; pageSize: number }>(
        '/surplus',
        {
          params: {
            ...params,
            group: 'lead',
            hideDead: 'true',
            page: pageParam,
            pageSize: PAGE_SIZE,
          },
        },
      );
      return data;
    },
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
}

/**
 * PATCH /surplus/:id. The server holds every gate (qualification before
 * Agreement Signed, a reason before Dead) and answers 400 with the sentence
 * to show, so the app never has to second-guess it.
 */
export function useUpdateSurplus(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (await api.patch<SurplusRow>(`/surplus/${leadId}`, patch)).data,
    onSuccess: (row) => {
      qc.setQueryData(['surplus', leadId], row);
      qc.invalidateQueries({ queryKey: ['surplus', 'list'] });
      qc.invalidateQueries({ queryKey: ['surplus', 'stats'] });
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'detail'] });
    },
  });
}

/** The message a 400 from the API carries, or a fallback. */
export function apiErrorMessage(e: any, fallback: string): string {
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m.join(' ');
  return (typeof m === 'string' && m) || e?.response?.data?.error || fallback;
}

// ─── Labels (mirrors packages/shared, which the app does not import) ──────────

/** SurplusStage, in pipeline order. Dead is handled separately. */
export const SURPLUS_STAGES = [
  'New',
  'Contacted',
  'Agreement Signed',
  'Package Notarized',
  'Claim Filed',
  'Awaiting Disbursement',
  'Check Received',
  'Paid',
];

export const DEAD_STAGE = 'Dead';

/** The next stage up the pipeline, or null at the end or when Dead. */
export function nextStage(stage?: string | null): string | null {
  const i = SURPLUS_STAGES.indexOf(stage || 'New');
  if (i < 0 || i >= SURPLUS_STAGES.length - 1) return null;
  return SURPLUS_STAGES[i + 1];
}

/** SurplusDeadReason with the web's wording. */
export const DEAD_REASONS: { value: string; label: string }[] = [
  { value: 'unresponsive', label: 'Unresponsive after the set attempts' },
  { value: 'already_assigned', label: 'Already signed with somebody else' },
  { value: 'competing_claim', label: 'Competing claim already filed' },
  { value: 'deceased_no_heirs', label: 'Deceased, no heirs located' },
  { value: 'below_floor', label: 'Surplus below the floor' },
  { value: 'other', label: 'Other' },
];

interface Tone {
  color: string;
  soft: string;
}

const SLATE: Tone = { color: '#475569', soft: '#F1F5F9' };
const BLUE: Tone = { color: '#1D4ED8', soft: '#DBEAFE' };
const AMBER: Tone = { color: '#A16207', soft: '#FEF9C3' };
const VIOLET: Tone = { color: '#6D28D9', soft: '#EDE9FE' };
const MINT: Tone = { color: '#047857', soft: '#D1FAE5' };
const RED: Tone = { color: '#B91C1C', soft: '#FEE2E2' };

const STAGE_TONE: Record<string, Tone> = {
  New: SLATE,
  Contacted: BLUE,
  'Agreement Signed': AMBER,
  'Package Notarized': VIOLET,
  'Claim Filed': MINT,
  'Awaiting Disbursement': MINT,
  'Check Received': MINT,
  Paid: MINT,
  Dead: RED,
};

export function stageTone(stage?: string | null): Tone {
  return STAGE_TONE[stage || 'New'] || SLATE;
}

const TIER: Record<string, Tone & { label: string; hint: string }> = {
  A: { label: 'Tier A', hint: '$25k+, living owner', ...RED },
  B: { label: 'Tier B', hint: '$10k to $25k', ...AMBER },
  C: { label: 'Tier C', hint: '$25k+, estate', ...VIOLET },
  U: { label: 'Unbanded', hint: 'Outside the tier bands', ...SLATE },
};

export function tierStyle(tier?: string | null) {
  return TIER[tier || 'U'] || TIER.U;
}

/** Docket status. Open and denied are the money still on the table. */
const CLAIM_STATUS_TONE: Record<string, Tone> = {
  open: MINT,
  denied: MINT,
  gov_lien: AMBER,
  pending: AMBER,
  assigned: RED,
  distributed: RED,
  unknown: SLATE,
};

export function claimStatusTone(status?: string | null): Tone {
  return CLAIM_STATUS_TONE[status || 'unknown'] || SLATE;
}

/** SurplusQueue: what to do next on the claimant, most actionable first. */
export const SURPLUS_QUEUES: { value: string; label: string }[] = [
  { value: 'call', label: 'Call now' },
  { value: 'likely', label: 'Likely match' },
  { value: 'trace', label: 'Skip trace' },
  { value: 'heirs', label: 'Find the heirs' },
  { value: 'name_search', label: 'Name search' },
  { value: 'entity', label: 'Entity' },
  { value: 'mailed', label: 'Letter sent' },
];

const QUEUE_TONE: Record<string, Tone> = {
  call: MINT,
  likely: BLUE,
  trace: AMBER,
  heirs: VIOLET,
  name_search: AMBER,
  entity: SLATE,
  mailed: SLATE,
  closed: SLATE,
};

export function queueTone(queue?: string | null): Tone {
  return QUEUE_TONE[queue || ''] || SLATE;
}

const CLAIMANT_TYPE_LABEL: Record<string, string> = {
  previous_owner: 'Previous owner',
  heir_estate: 'Heir or estate',
  lienholder: 'Lienholder',
};

export function claimantTypeLabel(t?: string | null): string {
  return (t && CLAIMANT_TYPE_LABEL[t]) || 'Claimant';
}

const SURPLUS_TYPE_LABEL: Record<string, string> = {
  tax_deed: 'Tax deed',
  mortgage_foreclosure: 'Mortgage foreclosure',
};

export function surplusTypeLabel(t?: string | null): string {
  return (t && SURPLUS_TYPE_LABEL[t]) || 'Surplus';
}

export function fundLocationLabel(l?: string | null): string {
  return l === 'state_escheated' ? 'Escheated to the state' : 'Held by the clerk';
}

/** The clerk's returned-mail verdict, in the web panel's words. */
export function mailVerdictLabel(v?: string | null): string | null {
  switch (v) {
    case 'delivered':
      return 'Delivered';
    case 'undeliverable':
      return 'Every mailing returned';
    case 'unclaimed':
      return 'Unclaimed, address is live';
    case 'mixed':
      return 'Some delivered, some returned';
    default:
      return null;
  }
}

/** "Not tapped" until the claimant has replied on any channel. */
export function contactStatusLabel(s?: string | null): string {
  if (s === 'tapped') return 'Tapped';
  if (s === 'recap_scheduled') return 'Tapped, recap scheduled';
  return 'Not tapped';
}

export function mailingAddress(r: SurplusRow): string | null {
  const line2 = [r.ownerMailingCity, [r.ownerMailingState, r.ownerMailingZip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [r.ownerMailingStreet, line2].filter(Boolean).join(', ') || null;
}

/** "Duval · 2025-0774TD", the line that identifies the case. */
export function caseLine(r: Pick<SurplusRow, 'county' | 'caseNumber'>): string {
  return [r.county ? `${r.county} County` : null, r.caseNumber].filter(Boolean).join(' · ');
}

// ─── Call outcomes (SurplusCallOutcome) ───────────────────────────────────────

/** In the order the course's call goes: reached, not reached, finished. */
export const SURPLUS_OUTCOMES: { value: string; label: string }[] = [
  { value: 'spoke_claimant', label: 'Spoke to claimant' },
  { value: 'callback_scheduled', label: 'Callback scheduled' },
  { value: 'wants_packet', label: 'Wants the credibility packet' },
  { value: 'spoke_relative', label: 'Spoke to relative, message passed' },
  { value: 'no_answer_voicemail', label: 'No answer, voicemail left' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'disconnected', label: 'Disconnected' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'already_signed', label: 'Already signed elsewhere' },
  { value: 'do_not_call', label: 'Asked not to be called' },
];

export const SURPLUS_OBJECTIONS: { value: string; label: string }[] = [
  { value: 'who_are_you', label: 'Who are you?' },
  { value: 'are_you_real', label: 'Are you for real?' },
  { value: 'cost', label: 'What does it cost?' },
  { value: 'trust', label: 'Can I trust you?' },
  { value: 'tell_me_more', label: 'Tell me more first' },
  { value: 'other', label: 'Something else' },
];

/** Mirrors surplusFollowUpRule: the API refuses a 'required' outcome without a date. */
export function followUpRule(outcome?: string | null): 'required' | 'optional' | 'none' {
  switch (outcome) {
    case 'callback_scheduled':
    case 'wants_packet':
    case 'spoke_relative':
      return 'required';
    case 'no_answer_voicemail':
    case 'no_answer':
    case 'spoke_claimant':
      return 'optional';
    default:
      return 'none';
  }
}

/** Mirrors surplusCallConnected: somebody picked up. */
export function callConnected(outcome?: string | null): boolean {
  return [
    'spoke_claimant',
    'spoke_relative',
    'not_interested',
    'wants_packet',
    'callback_scheduled',
    'already_signed',
    'do_not_call',
  ].includes(outcome || '');
}

/** The web dialer's four quick follow-up picks, so the team learns one set. */
export function quickDueDates(): { label: string; at: Date }[] {
  const at = (days: number, hour: number) => {
    const t = new Date();
    t.setDate(t.getDate() + days);
    t.setHours(hour, 0, 0, 0);
    return t;
  };
  return [
    { label: 'In 1 hour', at: new Date(Date.now() + 3600_000) },
    { label: 'Tomorrow 9am', at: at(1, 9) },
    { label: 'In 3 days', at: at(3, 9) },
    { label: 'Next week', at: at(7, 9) },
  ];
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "3d overdue", "due today", "due in 5d". */
export function dueLabel(iso?: string | null): string {
  if (!iso) return 'no date';
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (days === 0) return 'due today';
  if (diff < 0) return `${Math.abs(days)}d overdue`;
  return `due in ${days}d`;
}
