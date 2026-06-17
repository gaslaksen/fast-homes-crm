/** Mirrors the row shape returned by GET /inbox/threads (api InboxService.toRow). */
export interface InboxThread {
  leadId: string;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  sellerPhone: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  primaryPhoto: string | null;
  scoreBand: string | null;
  tags: string[] | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: 'INBOUND' | 'OUTBOUND' | null;
  threadUnread: boolean;
  threadStarred: boolean;
}

export interface InboxThreadsResponse {
  items: InboxThread[];
  hasMore: boolean;
  page: number;
}

export type InboxFilter = 'all' | 'unread' | 'starred' | 'recent';

/** Mirrors a row from GET /leads/:leadId/messages (raw Message record). */
export interface Message {
  id: string;
  leadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: string;
  body: string;
  from: string | null;
  to: string | null;
  sentAt: string | null;
  createdAt: string;
}
