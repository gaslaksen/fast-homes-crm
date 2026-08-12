import { ActionSheetIOS } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { prettyPhone } from '@/features/calls/hooks';

/**
 * One number the seller can be reached on. Foreclosure and probate skip traces
 * attach up to four, and the one on the lead is often the landline the county
 * had rather than the phone they carry, so texting and calling both need to be
 * able to aim at a different one.
 */
export interface LeadPhone {
  number: string;
  /** "Primary", "Phone 2", ... */
  label: string;
  /** 'Mobile' | 'Landline' | null, as the skip trace reported it. */
  type: string | null;
  isPrimary: boolean;
}

export interface LeadPhonesResponse {
  /** The number to preselect: the one they last replied from, else the primary. */
  selected: string;
  numbers: LeadPhone[];
}

/**
 * The seller's numbers. The API validates whatever the app sends back against
 * this same list, and rejects anything not on it rather than redirecting to the
 * primary, so a stale list cannot text a stranger.
 */
export function useLeadPhones(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'phones'],
    queryFn: async () => {
      const { data } = await api.get<LeadPhonesResponse>(
        `/leads/${leadId}/messages/to-options`,
      );
      return data;
    },
    enabled: !!leadId,
    staleTime: 60_000,
  });
}

/**
 * Promote a number to primary. Everything automated (drip, campaigns, initial
 * outreach, AI auto-response) sends to the primary, so this is what points them
 * at a number that answers.
 */
export function useSetPrimaryPhone(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (number: string) => {
      const { data } = await api.patch(`/leads/${leadId}/primary-phone`, { number });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'phones'] });
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'detail'] });
    },
  });
}

/** "Phone 2 · Mobile", the part of a row that says which number this is. */
export function phoneSubtitle(p: LeadPhone): string {
  return [p.label, p.type].filter(Boolean).join(' · ');
}

/** Action sheet listing the seller's numbers. Used by both texting and calling. */
export function showPhoneSheet(opts: {
  title: string;
  message?: string;
  numbers: LeadPhone[];
  onSelect: (p: LeadPhone) => void;
}) {
  const labels = opts.numbers.map((n) => `${prettyPhone(n.number)} · ${phoneSubtitle(n)}`);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: opts.title,
      message: opts.message,
      options: [...labels, 'Cancel'],
      cancelButtonIndex: labels.length,
    },
    (i) => {
      if (i != null && i < opts.numbers.length) opts.onSelect(opts.numbers[i]);
    },
  );
}
