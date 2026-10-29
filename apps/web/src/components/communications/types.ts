export type Actor =
  | { type: 'user'; name: string; avatarUrl: string | null }
  | { type: 'seller'; name: string }
  | { type: 'ai'; name: string }
  | { type: 'system'; name: string };

/**
 * Who on a surplus case a text, call or email was with. id is null for the
 * claimant. Absent on every other lead, which has one seller.
 */
export interface TimelinePerson {
  id: string | null;
  name: string;
  /** "Claimant", or the relationship or role: "Daughter", "Relative". */
  label: string;
}

/** A person in the thread's filter, with how many texts, calls and emails were with them. */
export interface ThreadPerson extends TimelinePerson {
  count: number;
}

export type TimelineItem =
  | {
      id: string;
      kind: 'sms';
      direction: 'INBOUND' | 'OUTBOUND';
      at: string;
      actor: Actor;
      person?: TimelinePerson | null;
      payload: {
        body: string;
        media?: { url: string; thumbnailUrl: string }[];
        /** The seller's end of this text: `to` outbound, `from` inbound. */
        sellerNumber?: string | null;
        /** False when it is one of the skip-traced numbers, not Lead.sellerPhone. */
        onPrimaryNumber?: boolean;
      };
    }
  | {
      id: string;
      kind: 'email';
      direction: 'INBOUND' | 'OUTBOUND';
      at: string;
      actor: Actor;
      person?: TimelinePerson | null;
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
      person?: TimelinePerson | null;
      payload: {
        status: string;
        type: string;
        duration: number | null;
        recordingUrl: string | null;
        /** The seller's end of the call: `toNumber` outbound, `fromNumber` inbound. */
        sellerNumber?: string | null;
        /** "Primary", "Phone 2", "Heir: ..." when the number is still on the lead. */
        numberLabel?: string | null;
        /** The caller left a message on our greeting; recordingUrl is the message. */
        voicemail?: boolean;
        /** Set for voicemails only. */
        transcript?: string | null;
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
  /** The user who wrote a note. Absent on call summaries. */
  authorId?: string | null;
  /** Set once a note has been changed after it was saved. */
  editedAt?: string | null;
}

export interface CommunicationsResponse {
  timeline: TimelineItem[];
  notes: NoteItem[];
}

export function actorInitialsName(actor: Actor): string {
  return actor.name || (actor.type === 'ai' ? 'AI' : actor.type === 'system' ? 'System' : '?');
}
