import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DispositionPlan {
  exitStrategy: string | null;
  targetSalePrice: number | null;
  targetCloseDate: string | null;
  jvPartnerId: string | null;
  jvPartner?: { id: string; name: string } | null;
  jvSplitMode: string | null;
  jvSplitPercent: number | null;
  notes: string | null;
}

export interface DispositionCost {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  incurredAt: string;
  paidTo: string | null;
}

export interface FinalSale {
  buyerName: string | null;
  finalSalePrice: number;
  saleClosingCosts: number | null;
  netProceeds: number | null;
  closedAt: string;
  notes: string | null;
}

export function useDispositionPlan(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'disposition-plan'],
    queryFn: async () =>
      (await api.get<DispositionPlan | null>(`/leads/${leadId}/disposition-plan`)).data,
    enabled: !!leadId,
  });
}

export function useDispositionCosts(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'disposition-costs'],
    queryFn: async () =>
      (await api.get<DispositionCost[]>(`/leads/${leadId}/disposition-costs`)).data,
    enabled: !!leadId,
  });
}

export function useFinalSale(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'final-sale'],
    queryFn: async () =>
      (await api.get<FinalSale | null>(`/leads/${leadId}/final-sale`)).data,
    enabled: !!leadId,
  });
}

const COST_LABELS: Record<string, string> = {
  holding: 'Holding',
  repair_prep: 'Repair / prep',
  utilities: 'Utilities',
  marketing: 'Marketing',
  closing: 'Closing',
  jv_payout: 'JV payout',
  other: 'Other',
};

export function costLabel(c: string): string {
  return COST_LABELS[c] || c;
}

const JV_SPLIT_LABELS: Record<string, string> = {
  fifty_fifty: '50 / 50',
  custom: 'Custom',
  none: '',
};

export function jvSplitLabel(mode?: string | null, percent?: number | null): string {
  if (!mode || mode === 'none') return '';
  if (mode === 'custom' && percent != null) return `${percent}% ours`;
  return JV_SPLIT_LABELS[mode] || mode;
}
