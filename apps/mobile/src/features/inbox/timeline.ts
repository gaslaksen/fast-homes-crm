import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MessageMedia } from './types';

export interface Actor {
  type: 'user' | 'ai' | 'seller' | 'system';
  name: string;
  avatarUrl?: string | null;
}

export type Direction = 'INBOUND' | 'OUTBOUND' | null;

export interface SmsPayload {
  body: string;
  media: MessageMedia[] | null;
}
export interface CallPayload {
  status: string | null;
  type: string | null;
  duration: number | null;
  recordingUrl: string | null;
}
export interface EmailPayload {
  subject: string | null;
  bodyText?: string | null;
}
export interface EventPayload {
  type: string;
  description: string | null;
  metadata?: Record<string, any> | null;
}
export interface CommentPayload {
  body: string;
  mentions?: { id: string; name: string }[];
}

export type TimelineItem =
  | { id: string; kind: 'sms'; direction: Direction; at: string; actor: Actor; payload: SmsPayload }
  | { id: string; kind: 'call'; direction: Direction; at: string; actor: Actor; payload: CallPayload }
  | { id: string; kind: 'email'; direction: Direction; at: string; actor: Actor; payload: EmailPayload }
  | { id: string; kind: 'event'; direction: Direction; at: string; actor: Actor; payload: EventPayload }
  | { id: string; kind: 'comment'; direction: Direction; at: string; actor: Actor; payload: CommentPayload };

export interface CommunicationsResponse {
  timeline: TimelineItem[];
  notes: unknown[];
}

/** The merged conversation: SMS + calls (with recordings) + emails + events + comments. */
export function useCommunications(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId, 'communications'],
    queryFn: async () => {
      const { data } = await api.get<CommunicationsResponse>(
        `/leads/${leadId}/communications`,
      );
      return data;
    },
    enabled: !!leadId,
    refetchInterval: 10_000,
  });
}
