import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Calls from numbers that matched no lead: voicemails, missed calls and calls
 * someone answered. The same list the web inbox shows at the top. A call
 * from a known number is already on that lead's thread instead.
 */
export interface UnknownCall {
  id: string;
  fromNumber: string | null;
  toNumber: string | null;
  createdAt: string;
  duration: number | null;
  recordingUrl: string | null;
  transcript: string | null;
  kind?: 'voicemail' | 'missed' | 'answered' | 'ringing';
  /** People holding a number a few digits off this one, nearest first. */
  suggestions?: AttachOption[];
}

/** A lead, or a person on its case, that a call can be filed under. */
export interface AttachOption {
  kind?: 'lead' | 'person';
  leadId: string;
  heirId: string | null;
  name: string;
  /** "Other relative", "Claimant", "Lead". */
  label: string;
  leadName: string;
  propertyAddress: string | null;
  source: string | null;
  /** Suggestions only: the near number we hold for them. */
  numberOnFile?: string;
}

/** One number already on file, with how calling it has gone. */
export interface NumberSlot {
  number: string;
  type: string | null;
  bad: boolean;
  dnc: string | null;
  isPrimary: boolean;
  calls: number;
  lastCallAt: string | null;
  lastResult: string | null;
}

export type SaveNumberResult =
  | { saved: true; already?: boolean }
  | { saved: false; reason: 'full'; name: string; capacity: number; slots: NumberSlot[] };

const KEY = ['inbox', 'unknown-calls'] as const;

export function useUnknownCalls() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data } = await api.get<{ items: UnknownCall[] }>('/inbox/voicemails');
      return data.items || [];
    },
    refetchInterval: 30_000,
  });
}

export function useDismissCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/inbox/voicemails/${id}/dismiss`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** File the call under a lead, and the person on the case who made it. */
export function useAttachCall() {
  return useMutation({
    mutationFn: async (args: { id: string; leadId: string; heirId: string | null }) => {
      await api.post(`/inbox/voicemails/${args.id}/attach`, { leadId: args.leadId, heirId: args.heirId });
    },
  });
}

/** Save the caller's number on them; `replace` swaps out one of a full set. */
export function useSaveNumber() {
  return useMutation({
    mutationFn: async (body: { leadId: string; heirId: string | null; number: string; replace?: string | null }) => {
      const { data } = await api.post<SaveNumberResult>('/inbox/save-number', body);
      return data;
    },
  });
}

/** Leads and the people on their cases by name, address or any number on file. */
export function useAttachSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['inbox', 'attach-search', query],
    queryFn: async () => {
      const { data } = await api.get<{ results: AttachOption[] }>('/inbox/attach-search', { params: { q: query } });
      return data.results || [];
    },
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}

/** The people on a surplus case, for "who called". */
export function useCasePeople(leadId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['surplus', leadId, 'heirs'],
    queryFn: async () => {
      const { data } = await api.get<{ heirs: { id: string; name: string; relationship?: string | null; roleLabel?: string | null }[] }>(
        `/surplus/${leadId}/heirs`,
      );
      return data.heirs || [];
    },
    enabled: !!leadId && enabled,
  });
}

export function prettyNumber(raw?: string | null): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

export function timeAgoLong(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
