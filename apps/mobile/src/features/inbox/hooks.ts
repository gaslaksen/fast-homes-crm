import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { InboxFilter, InboxThread, InboxThreadsResponse, Message } from './types';

const THREADS_PAGE_SIZE = 25;

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

/**
 * Paged conversation list. The API caps a page, so the inbox pulls the next
 * page as you scroll rather than stopping at the first screenful, so every
 * conversation is reachable.
 */
export function useThreads(filter: InboxFilter = 'all', search = '') {
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: ['inbox', 'threads', filter, q],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<InboxThreadsResponse>('/inbox/threads', {
        params: {
          filter,
          page: pageParam,
          limit: THREADS_PAGE_SIZE,
          ...(q ? { search: q } : {}),
        },
      });
      return data;
    },
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    select: (data) => ({
      pages: data.pages,
      pageParams: data.pageParams,
      items: data.pages.flatMap((p) => p.items) as InboxThread[],
    }),
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
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (message: string) => {
      // Pass userId so the message is attributed to the sender (not AI).
      const { data } = await api.post(`/leads/${leadId}/messages/send`, {
        message,
        userId: user?.id,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'messages'] });
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'communications'] });
      qc.invalidateQueries({ queryKey: ['inbox', 'threads'] });
    },
  });
}

/** Reply to an email in the thread via Mailgun. */
export function useSendEmailReply(leadId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: { subject?: string; body: string; to?: string; inReplyToEmailId?: string }) => {
      const { data } = await api.post(`/leads/${leadId}/messages/emails/send`, {
        userId: user?.id,
        subject: params.subject,
        body: params.body,
        to: params.to,
        inReplyToEmailId: params.inReplyToEmailId,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', leadId, 'communications'] });
      qc.invalidateQueries({ queryKey: ['inbox', 'threads'] });
    },
  });
}

/**
 * Marks the thread read for the signed-in user only. A teammate opening the
 * same conversation no longer clears it from your inbox.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      await api.post(`/inbox/threads/${leadId}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox', 'threads'] });
      // Refreshes the tab badge and the app icon badge.
      qc.invalidateQueries({ queryKey: ['inbox', 'counts'] });
    },
  });
}
