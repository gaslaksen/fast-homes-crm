import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ActionLead {
  id: string;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  tier: number | null;
  scoreBand: string | null;
  status: string;
  primaryPhoto: string | null;
}

export interface ActionItem {
  actionKey: string;
  type: string;
  priority: number;
  leadId: string;
  lead: ActionLead;
  title: string;
  subtitle: string;
  createdAt: string;
}

export interface DashboardStats {
  totalLeads: number;
  newLeadsThisWeek: number;
  staleLeads: number;
  needsFollowUp: number;
  underContract: number;
  closedDeals: number;
  totalRevenue: number;
  conversionRate: number;
  pipelineArvTotal: number;
  potentialAssignmentFees: number;
  leadsByBand: Record<string, number>;
  leadsByStatus: Record<string, number>;
}

export interface HotLead {
  id: string;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  scoreBand: string | null;
  totalScore: number | null;
  arv: number | null;
  askingPrice: number | null;
  primaryPhoto: string | null;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => (await api.get<DashboardStats>('/dashboard/stats')).data,
    staleTime: 60_000,
  });
}

export function useActionQueue(limit = 8) {
  return useQuery({
    queryKey: ['dashboard', 'actions', limit],
    queryFn: async () => {
      const { data } = await api.get<{ items: ActionItem[] }>('/actions/queue', {
        params: { limit, sort: 'priority' },
      });
      return data.items;
    },
    refetchInterval: 30_000,
  });
}

export interface PipelineLead {
  id: string;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  status: string;
  scoreBand: string | null;
  tier: number | null;
  arv: number | null;
  askingPrice: number | null;
  primaryPhoto: string | null;
  daysInStage?: number;
}

export function usePipeline() {
  return useQuery({
    queryKey: ['dashboard', 'pipeline'],
    queryFn: async () => {
      const { data } = await api.get<{ leadsByStage: Record<string, PipelineLead[]> }>(
        '/pipeline',
      );
      return data.leadsByStage;
    },
    staleTime: 60_000,
  });
}

export interface InboxCounts {
  all: number;
  unread: number;
  starred: number;
}

export function useInboxCounts() {
  return useQuery({
    queryKey: ['inbox', 'counts'],
    queryFn: async () => (await api.get<InboxCounts>('/inbox/counts')).data,
    staleTime: 30_000,
  });
}

export function useHotLeads(limit = 6) {
  return useQuery({
    queryKey: ['dashboard', 'hot-leads', limit],
    queryFn: async () => {
      const { data } = await api.get<HotLead[]>('/dashboard/hot-leads', {
        params: { limit },
      });
      return data;
    },
    staleTime: 60_000,
  });
}

// ─── Action category presentation ────────────────────────────────────────────

interface ActionMeta {
  label: string;
  color: string;
  soft: string;
  /** Whether tapping should open the conversation (vs. the lead detail). */
  toConversation: boolean;
}

const ACTION_META: Record<string, ActionMeta> = {
  NEEDS_REPLY: { label: 'Reply', color: '#0F766E', soft: '#CCFBF1', toConversation: true },
  NEW_LEAD_INBOUND: { label: 'New lead', color: '#0F766E', soft: '#CCFBF1', toConversation: true },
  DRIP_REPLY_REVIEW: { label: 'Review', color: '#6B7280', soft: '#F3F4F6', toConversation: true },
  STALE_HOT_LEAD: { label: 'Going cold', color: '#C2410C', soft: '#FFEDD5', toConversation: false },
  OFFER_READY: { label: 'Offer', color: '#15803D', soft: '#DCFCE7', toConversation: false },
  CAMP_INCOMPLETE: { label: 'Qualify', color: '#A16207', soft: '#FEF9C3', toConversation: false },
  FOLLOW_UP_DUE: { label: 'Follow up', color: '#1D4ED8', soft: '#DBEAFE', toConversation: true },
  CONTRACT_PENDING: { label: 'Contract', color: '#15803D', soft: '#DCFCE7', toConversation: false },
  EXHAUSTED_LEAD: { label: 'Exhausted', color: '#6B7280', soft: '#F3F4F6', toConversation: false },
};

export function actionMeta(type: string): ActionMeta {
  return (
    ACTION_META[type] || { label: 'Action', color: '#6B7280', soft: '#F3F4F6', toConversation: false }
  );
}
