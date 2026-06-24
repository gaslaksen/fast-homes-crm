import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { InboxFilter, InboxThreadsResponse, Message } from './types';

/** Ask the AI to draft a reply for this lead. Returns the suggested message. */
export function useGenerateDraft(leadId: string) {
  return useMutation({
    mutationFn: async (context?: string) => {
      const { data } = await api.post<{ message: string }>(
        `/leads/${leadId}/messages/draft`,
        { context },
      );
      return data.message;
    },
  });
}

export function useThreads(filter: InboxFilter = 'all') {
  return useQuery({
    queryKey: ['inbox', 'threads', filter],
    queryFn: async () => {
      const { data } = await api.get<InboxThreadsResponse>('/inbox/threads', {
        params: { filter },
      });
      return data;
    },
  });
}

export function useMessages(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'messages'],
    queryFn: async () => {
      const { data } = await api.get<Message[]>(`/leads/${leadId}/messages`);
      return data;
    },
    enabled: !!leadId,
    refetchInterval: 10_000,
  });
}

export function useSendMessage(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (message: string) => {
      const { data } = await api.post(`/leads/${leadId}/messages/send`, { message });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'messages'] });
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'communications'] });
      qc.invalidateQueries({ queryKey: ['inbox', 'threads'] });
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      await api.post(`/inbox/threads/${leadId}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox', 'threads'] });
    },
  });
}
