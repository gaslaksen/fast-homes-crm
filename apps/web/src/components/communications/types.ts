export type Actor =
  | { type: 'user'; name: string; avatarUrl: string | null }
  | { type: 'seller'; name: string }
  | { type: 'ai'; name: string }
  | { type: 'system'; name: string };

export type TimelineItem =
  | {
      id: string;
      kind: 'sms';
      direction: 'INBOUND' | 'OUTBOUND';
      at: string;
      actor: Actor;
      payload: { body: string; media?: { url: string; thumbnailUrl: string }[] };
    }
  | {
      id: string;
      kind: 'email';
      direction: 'INBOUND' | 'OUTBOUND';
      at: string;
      actor: Actor;
      payload: {
        subject: string;
        fromAddress: string;
        toAddress: string;
        bodyText: string;
        bodyHtml: string | null;
      };
    }
  | {
      id: string;
      kind: 'call';
      direction: 'INBOUND' | 'OUTBOUND';
      at: string;
      actor: Actor;
      payload: {
        status: string;
        type: string;
        duration: number | null;
        recordingUrl: string | null;
      };
    }
  | {
      id: string;
      kind: 'event';
      direction: null;
      at: string;
      actor: Actor;
      payload: { type: string; description: string; metadata: any };
    }
  | {
      id: string;
      kind: 'comment';
      direction: null;
      at: string;
      actor: Actor;
      payload: { body: string; mentions: { id: string; name: string }[] };
    };

export interface NoteItem {
  id: string;
  kind: 'note' | 'call_summary';
  at: string;
  actor: Actor;
  title: string;
  body: string | null;
  transcript: string | null;
}

export interface CommunicationsResponse {
  timeline: TimelineItem[];
  notes: NoteItem[];
}

export function actorInitialsName(actor: Actor): string {
  return actor.name || (actor.type === 'ai' ? 'AI' : actor.type === 'system' ? 'System' : '?');
}
