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

export interface CallerId {
  number: string;
  label: string;
}

/**
 * Numbers this org may call from. The API validates whatever the app sends
 * against this same list, so an unknown value just falls back to the default.
 */
export function useCallerIds(enabled = true) {
  return useQuery({
    queryKey: ['calls', 'caller-ids'],
    queryFn: async () => {
      const { data } = await api.get<{ numbers: CallerId[] }>('/calls/twilio/numbers');
      return data.numbers ?? [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** "(704) 529-9523" from any 10 or 11 digit form. */
export function prettyPhone(raw?: string | null): string {
  const digits = (raw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw || '';
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
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
