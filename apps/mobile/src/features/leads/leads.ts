import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DealNumbers {
  strategy: string;
  arv: number | null;
  repairEstimate: number | null;
  outputs: Record<string, number | null>;
  computedAt: string;
}

export interface LeadDetail {
  id: string;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  sellerPhone: string | null;
  sellerEmail: string | null;
  sellerMotivation: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  primaryPhoto: string | null;
  arv: number | null;
  arvConfidence: number | null;
  currentRepairEstimate: number | null;
  currentDealNumbers: DealNumbers | null;
  askingPrice: number | null;
  reapiEquity: number | null;
  timeline: number | null;
  conditionLevel: string | null;
  ownershipStatus: string | null;
  totalScore: number | null;
  scoreBand: string | null;
  tier: number | null;
  status: string;
  tags: string[] | null;
  autoRespond: boolean;
}

/** Full lead detail. Shares the cache key with the lighter useLead(). */
export function useLeadDetail(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'detail'],
    queryFn: async () => {
      const { data } = await api.get<LeadDetail>(`/leads/${leadId}`);
      return data;
    },
    enabled: !!leadId,
  });
}

export function useUpdateLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<LeadDetail>) => {
      const { data } = await api.patch<LeadDetail>(`/leads/${leadId}`, patch);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'detail'] });
      qc.invalidateQueries({ queryKey: ['inbox', 'threads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ─── Deal extraction (outputs vary by disposition strategy) ──────────────────

const STRATEGY_LABEL: Record<string, string> = {
  wholesale: 'Wholesale',
  jv: 'JV',
  fix_flip: 'Fix & flip',
  novation: 'Novation',
  sub_to: 'Subject-to',
  double_close: 'Double close',
  hold_rental: 'Hold / rental',
  concierge_listing: 'Concierge listing',
  other: 'Custom',
};

export function strategyLabel(s?: string | null): string {
  return (s && STRATEGY_LABEL[s]) || 'Deal';
}

/** Pull a headline offer + profit out of strategy-specific deal outputs. */
export function dealHeadline(
  d: DealNumbers | null,
): { offer: number | null; profit: number | null; profitLabel: string } | null {
  if (!d?.outputs) return null;
  const o = d.outputs;
  const offer =
    o.mao ?? o.initialOffer ?? o.acquisitionPrice ?? o.listPrice ?? null;
  const profit =
    o.spread ??
    o.assignmentFee ??
    o.netProfit ??
    o.estimatedProfit ??
    o.totalProfit ??
    o.ourShare ??
    null;
  const profitLabel = o.spread != null || o.assignmentFee != null ? 'Spread' : 'Profit';
  return { offer, profit, profitLabel };
}

// ─── Score band styling ──────────────────────────────────────────────────────

interface BandStyle {
  label: string;
  color: string;
  soft: string;
}

const BANDS: Record<string, BandStyle> = {
  HOT: { label: 'Hot', color: '#B91C1C', soft: '#FEE2E2' },
  STRIKE_ZONE: { label: 'Strike zone', color: '#C2410C', soft: '#FFEDD5' },
  WORKABLE: { label: 'Workable', color: '#A16207', soft: '#FEF9C3' },
  WARM: { label: 'Warm', color: '#0F766E', soft: '#CCFBF1' },
  COOL: { label: 'Cool', color: '#6B7280', soft: '#F3F4F6' },
  COLD: { label: 'Cold', color: '#6B7280', soft: '#F3F4F6' },
  DEAD_COLD: { label: 'Dead', color: '#9CA3AF', soft: '#F3F4F6' },
};

export function bandStyle(band?: string | null): BandStyle {
  return BANDS[band || ''] || { label: band || '—', color: '#6B7280', soft: '#F3F4F6' };
}

export function statusLabel(status?: string | null): string {
  if (!status) return '';
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function fullName(l: {
  sellerFirstName?: string | null;
  sellerLastName?: string | null;
  sellerPhone?: string | null;
}): string {
  return (
    [l.sellerFirstName, l.sellerLastName].filter(Boolean).join(' ') ||
    l.sellerPhone ||
    'Unknown'
  );
}
