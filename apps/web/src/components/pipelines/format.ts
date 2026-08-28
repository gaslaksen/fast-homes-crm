/**
 * Formatting and colour maps shared by the Tax Sales and Surplus Funds boards.
 *
 * Every colour resolves to a CSS variable defined in pipeline-board.css rather
 * than a literal, so a chip themes with the page instead of staying dark when
 * the rest of Dealcore is in light mode.
 */

export type ChipColor = { fg: string; bg: string };

const chip = (name: string): ChipColor => ({
  fg: `var(--chip-${name}-fg)`,
  bg: `var(--chip-${name}-bg)`,
});

export const CHIP = {
  red: chip('red'),
  amber: chip('amber'),
  blue: chip('blue'),
  violet: chip('violet'),
  pink: chip('pink'),
  mint: chip('mint'),
  slate: chip('slate'),
};

export function money(n?: number | null): string {
  return n || n === 0 ? `$${Number(n).toLocaleString('en-US')}` : '-';
}

export function fmtDate(v?: string | Date | null): string {
  if (!v) return '-';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US');
}

export function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** Mon-Fri, the only days the boards track a touch on. */
export const DAYS: [string, string, string][] = [
  ['mon', 'M', 'Monday'],
  ['tue', 'T', 'Tuesday'],
  ['wed', 'W', 'Wednesday'],
  ['thu', 'T', 'Thursday'],
  ['fri', 'F', 'Friday'],
];

// ── Tax Sales ───────────────────────────────────────────────────────────────

export const PRIORITY: Record<string, { label: string } & ChipColor> = {
  HIGH: { label: 'HIGH', ...CHIP.red },
  MEDIUM: { label: 'MEDIUM', ...CHIP.amber },
  LOW: { label: 'LOW', ...CHIP.blue },
};

export const TAX_STAGE_LABEL: Record<string, string> = {
  JUDGMENT_DOCKETED: 'Judgment Docketed',
  SALE_SCHEDULED: 'Sale Scheduled',
  UPSET_BID_PERIOD: 'Upset Bid Period',
  REDEEMED: 'Redeemed',
};

export const TAX_STAGE_COLOR: Record<string, ChipColor> = {
  JUDGMENT_DOCKETED: CHIP.slate,
  SALE_SCHEDULED: CHIP.amber,
  UPSET_BID_PERIOD: CHIP.red,
  REDEEMED: CHIP.mint,
};

export const WORK_STATUS_LABEL: Record<string, string> = {
  NOT_CONTACTED: 'Not Contacted',
  ATTEMPTED: 'Attempted',
  IN_CONVERSATION: 'In Conversation',
  APPOINTMENT_SET: 'Appointment Set',
  UNDER_CONTRACT: 'Under Contract',
  DEAD: 'Dead',
};

export const OCCUPANCY_LABEL: Record<string, string> = {
  OWNER_OCCUPIED: 'Owner-occupied',
  ABSENTEE: 'Absentee',
  VACANT: 'Vacant',
  UNKNOWN: 'Unknown',
};

export const METHOD_LABEL: Record<string, string> = {
  IN_REM: 'In Rem',
  JUDICIAL: 'Judicial',
};

export const TAG_COLOR: Record<string, ChipColor> = {
  'Owner-occupied': CHIP.violet,
  'Title complexity': CHIP.amber,
  Estate: CHIP.pink,
  'Heirs required': CHIP.pink,
  Vacant: CHIP.slate,
  Absentee: CHIP.blue,
};

/** Why a number must not be dialed. */
export const DNC_STATE: Record<string, { label: string } & ChipColor> = {
  federal: { label: 'Federal DNC', ...CHIP.red },
  state: { label: 'State DNC', ...CHIP.red },
  litigator: { label: 'Litigator', ...CHIP.red },
  tcpa: { label: 'TCPA restricted', ...CHIP.red },
};

export const WORKUP_LABEL: Record<string, string> = {
  title: 'Title pulled',
  owner: 'Owner verified',
  occupancy: 'Occupancy confirmed',
  drive: 'Drive by done',
};

// ── Surplus Funds ───────────────────────────────────────────────────────────

export const TIER: Record<string, { icon: string; label: string } & ChipColor> = {
  A: { icon: '🔥', label: 'Tier A', ...CHIP.red },
  B: { icon: '⚡', label: 'Tier B', ...CHIP.amber },
  C: { icon: '⚖', label: 'Tier C', ...CHIP.violet },
  U: { icon: '•', label: 'Unbanded', ...CHIP.blue },
};

export const SURPLUS_STAGES = [
  'New',
  'Contacted',
  'Agreement Signed',
  'Assignment Notarized',
  'Claim Filed',
  'Paid',
];

export const SURPLUS_STAGE_COLOR: Record<string, ChipColor> = {
  New: CHIP.slate,
  Contacted: CHIP.blue,
  'Agreement Signed': CHIP.amber,
  'Assignment Notarized': CHIP.violet,
  'Claim Filed': CHIP.mint,
  Paid: CHIP.mint,
  Dead: CHIP.red,
};

export const DRIP_TRACK_COLOR: Record<string, ChipColor> = {
  'Heir/Estate': CHIP.pink,
  Urgent: CHIP.red,
  Compressed: CHIP.amber,
  Standard: CHIP.blue,
};

export const CLAIMANT_TYPE_LABEL: Record<string, string> = {
  previous_owner: 'Previous owner',
  heir_estate: 'Heir or estate',
  lienholder: 'Lienholder',
};

export const DOC_LABEL: Record<string, string> = {
  claimForm: 'Clerk claim form',
  photoId: 'Photo ID',
  proofOwnership: 'Deed or proof of ownership',
  w9: 'W-9',
  feeAgreement: 'Fee agreement',
  titleSearch: 'Title search',
  deathCert: 'Death certificate',
  letters: 'Letters of administration',
};

// ── CSV ─────────────────────────────────────────────────────────────────────

export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [header.map(esc).join(',')].concat(rows.map((r) => r.map(esc).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** "(704) 555-0100" from 10 digits, left alone if it is not 10. */
export function phoneDisplay(digits: string): string {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length !== 10) return digits;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * "today", "3d ago", "never" - how stale a lead's last outbound touch is.
 *
 * Reads as an age rather than a date because that is the question being asked
 * of it: a date makes the reader do the subtraction, and the whole point of the
 * column is spotting the ones nobody has touched in a fortnight.
 */
export function agoLabel(v?: string | Date | null): string {
  if (!v) return 'never';
  const then = new Date(v).getTime();
  if (!Number.isFinite(then)) return 'never';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
}

/** Days since a timestamp, for sorting. Never-touched sorts oldest. */
export function agoDays(v?: string | Date | null): number {
  if (!v) return Number.MAX_SAFE_INTEGER;
  const then = new Date(v).getTime();
  if (!Number.isFinite(then)) return Number.MAX_SAFE_INTEGER;
  return Math.floor((Date.now() - then) / 86400000);
}
