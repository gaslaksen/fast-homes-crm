import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface LeadSummary {
  id: string;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  sellerPhone: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
}

export interface RecentCall {
  id: string;
  twilioCallSid: string | null;
  toNumber: string | null;
  fromNumber: string | null;
  status: string | null;
  duration: number | null;
  disposition: string | null;
  createdAt: string;
  lead: {
    id: string;
    sellerFirstName: string | null;
    sellerLastName: string | null;
    sellerPhone: string | null;
  } | null;
}

export function useLead(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'detail'],
    queryFn: async () => {
      const { data } = await api.get<LeadSummary>(`/leads/${leadId}`);
      return data;
    },
    enabled: !!leadId,
  });
}

export function useRecentCalls() {
  return useQuery({
    queryKey: ['calls', 'recents'],
    queryFn: async () => {
      const { data } = await api.get<{ calls: RecentCall[] }>('/calls/twilio/recents');
      return data.calls;
    },
  });
}

export function leadName(l: {
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
