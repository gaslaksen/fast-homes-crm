import { ScoreBand, ABCDFit } from './types';

/**
 * Calculate score band from total score (0-12)
 */
export function calculateScoreBand(totalScore: number): ScoreBand {
  if (totalScore >= 10) return ScoreBand.STRIKE_ZONE;
  if (totalScore >= 7) return ScoreBand.HOT;
  if (totalScore >= 4) return ScoreBand.WORKABLE;
  return ScoreBand.DEAD_COLD;
}

/**
 * Calculate ABCD fit from score band
 */
export function calculateABCDFit(scoreBand: ScoreBand | string): ABCDFit {
  switch (scoreBand) {
    case ScoreBand.STRIKE_ZONE:
    case 'STRIKE_ZONE':
      return ABCDFit.A;
    case ScoreBand.HOT:
    case 'HOT':
      return ABCDFit.B;
    case ScoreBand.WORKABLE:
    case 'WORKABLE':
      return ABCDFit.C;
    case ScoreBand.DEAD_COLD:
    case 'DEAD_COLD':
      return ABCDFit.D;
    default:
      return ABCDFit.D;
  }
}

/**
 * Format phone number for Twilio (E.164 format)
 */
export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('+')) {
    return phone;
  }
  
  return `+${cleaned}`;
}

/**
 * Check if message is opt-out
 */
export function isOptOutMessage(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  const optOutKeywords = ['stop', 'unsubscribe', 'cancel', 'end', 'quit'];
  return optOutKeywords.some(keyword => normalized === keyword);
}

/**
 * Validate US zip code
 */
export function validateZipCode(zip: string): boolean {
  const cleaned = zip.trim();
  return /^\d{5}(-\d{4})?$/.test(cleaned);
}

/**
 * Generate activity description
 */
export function generateActivityDescription(type: string, metadata?: Record<string, any>): string {
  switch (type) {
    case 'LEAD_CREATED':
      return `Lead created from ${metadata?.source || 'unknown source'}`;
    case 'STATUS_CHANGED':
      return `Status changed from ${metadata?.oldStatus} to ${metadata?.newStatus}`;
    case 'SCORE_UPDATED':
      return `Score updated: ${metadata?.oldScore} → ${metadata?.newScore} (${metadata?.band})`;
    case 'MESSAGE_SENT':
      return `Message sent to ${metadata?.to}`;
    case 'MESSAGE_RECEIVED':
      return `Message received from ${metadata?.from}`;
    case 'COMPS_FETCHED':
      return `Comps fetched: ${metadata?.count} comparables found, ARV: $${metadata?.arv?.toLocaleString()}`;
    case 'NOTE_ADDED':
      return 'Note added';
    case 'TASK_CREATED':
      return `Task created: ${metadata?.title}`;
    case 'TASK_COMPLETED':
      return `Task completed: ${metadata?.title}`;
    case 'FIELD_UPDATED':
      return `Field updated: ${metadata?.field}`;
    default:
      return 'Activity logged';
  }
}
