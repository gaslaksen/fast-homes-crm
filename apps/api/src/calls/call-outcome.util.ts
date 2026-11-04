/**
 * What happened on a call, read off its CallLog row.
 *
 * An inbound call rings the agents through a <Dial>. When that <Dial> ends,
 * Twilio posts its DialCallStatus to our action URL and handleStatusCallback
 * copies it into `endedReason`. Anything other than a pickup is a missed call.
 *
 * Twilio does not document whether that action URL is requested when the
 * caller hangs up while it is still ringing, so a row can also be left at
 * `in-progress` with no outcome at all. Nobody picked that one up either:
 * every answered call reaches the action URL with `completed`. The sweep in
 * MissedCallService closes those rows out as `caller-hangup`, and until it
 * runs they are read as missed once they are old enough.
 */

/** DialCallStatus values, plus our own sweep's, that mean nobody picked up. */
export const MISSED_DIAL_OUTCOMES = new Set(['no-answer', 'busy', 'failed', 'canceled', 'caller-hangup']);

/** How long an inbound row may sit at `in-progress` before it counts as missed. */
export const STUCK_INBOUND_MS = 10 * 60 * 1000;

export interface CallOutcomeRow {
  type?: string | null;
  status?: string | null;
  endedReason?: string | null;
  voicemail?: boolean | null;
  createdAt?: Date | string | null;
}

export function isInboundCall(row: CallOutcomeRow): boolean {
  return String(row.type || '').includes('inbound');
}

/**
 * An inbound call nobody answered. A voicemail is one too, but it is reported
 * as a voicemail instead, since the caller did reach us.
 */
export function isMissedInbound(row: CallOutcomeRow, now: Date = new Date()): boolean {
  if (!isInboundCall(row) || row.voicemail) return false;
  if (row.endedReason && MISSED_DIAL_OUTCOMES.has(row.endedReason)) return true;
  if (row.status === 'in-progress' && !row.endedReason && row.createdAt) {
    return now.getTime() - new Date(row.createdAt).getTime() > STUCK_INBOUND_MS;
  }
  return false;
}

/** The one word a call list shows for how a call went. */
export function callOutcome(
  row: CallOutcomeRow,
  now: Date = new Date(),
): 'voicemail' | 'missed' | 'answered' | 'ringing' | 'outbound' {
  if (!isInboundCall(row)) return 'outbound';
  if (row.voicemail) return 'voicemail';
  if (isMissedInbound(row, now)) return 'missed';
  if (row.status === 'in-progress' && !row.endedReason) return 'ringing';
  return 'answered';
}

/** "Tina Lynn Davis" or "Tina Lynn Davis (re David G Kelly)" when they differ. */
export function callerDisplayName(personName: string | null | undefined, leadName: string | null | undefined): string {
  const person = (personName || '').trim();
  const lead = (leadName || '').trim();
  if (person && lead && person.toLowerCase() !== lead.toLowerCase()) return `${person} (re ${lead})`;
  return person || lead;
}
