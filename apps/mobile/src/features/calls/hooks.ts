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
  /** twilio_browser (we dialled) or twilio_inbound (they rang us). */
  type?: string | null;
  /** Older API builds send none of the fields below. */
  direction?: 'INBOUND' | 'OUTBOUND';
  callResult?: 'voicemail' | 'missed' | 'answered' | 'ringing' | 'outbound';
  /** The other end of the call: who rang us, or who we rang. */
  number?: string | null;
  /** The person on a surplus case, when it was not the claimant. */
  personName?: string | null;
  /** "Tina Lynn Davis (re David G Kelly)", or the lead's name. */
  displayName?: string | null;
}

/** A voicemail left on any of our lines, matched to a lead or not. */
export interface Voicemail {
  id: string;
  fromNumber: string | null;
  toNumber: string | null;
  createdAt: string;
  duration: number | null;
  recordingUrl: string | null;
  transcript: string | null;
  lead: { id: string; sellerFirstName: string | null; sellerLastName: string | null } | null;
  heir: { id: string; name: string } | null;
  displayName: string | null;
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
      const { data } = await api.get<{ calls: RecentCall[] }>('/calls/twilio/recents', { params: { limit: 40 } });
      return data.calls;
    },
    refetchInterval: 30_000,
  });
}

export function useVoicemails(enabled: boolean) {
  return useQuery({
    queryKey: ['calls', 'voicemails'],
    queryFn: async () => {
      const { data } = await api.get<{ voicemails: Voicemail[] }>('/calls/twilio/voicemails');
      return data.voicemails;
    },
    enabled,
    refetchInterval: 60_000,
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
