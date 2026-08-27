'use client';

import { CHIP, money } from './format';

/**
 * One subject property on the board.
 *
 * ── Why this replaced the old card ──────────────────────────────────────────
 *
 * The previous card carried the whole record: clock bar, net and fee, stage
 * select, per-day touch boxes, document checklist, compliance panel, notes box
 * and every phone number. That is fine for three leads and unusable for
 * seventy. Nothing could be scanned, because everything was equally loud.
 *
 * A card now answers four questions and nothing else:
 *
 *   1. Is anyone else on this money?   claim status, the loudest element
 *   2. How much is it?                 the surplus
 *   3. Whose is it and where are they? owners plus the address the notice went to
 *   4. Can we reach them?              one contact line
 *
 * Everything else moved into the work panel, which is where a lead is actually
 * worked. The card's job is to decide whether to open it.
 *
 * ── One card per PROPERTY ───────────────────────────────────────────────────
 *
 * A single sale can owe several people, and each is a separate claim with its
 * own conversation. Rendered per claimant, one house appeared as two identical
 * cards (Myrtis Griffin and Jessie Hall, both owed on 0 Hardee St) with no
 * visible reason for the repeat. Grouping happens server-side so it survives
 * pagination; this component renders the group.
 */

const STATUS_CHIP: Record<string, { fg: string; bg: string }> = {
  denied: CHIP.mint,
  open: CHIP.mint,
  gov_lien: CHIP.amber,
  pending: CHIP.amber,
  assigned: CHIP.red,
  distributed: CHIP.red,
  unknown: CHIP.slate,
};

/**
 * The accent down the left edge. Claim status is the first thing that decides
 * whether a property is worth a call, so it is the thing the eye lands on when
 * skimming a rack of seventy.
 */
export const STATUS_ACCENT: Record<string, string> = {
  denied: 'var(--mint)',
  open: 'var(--mint)',
  gov_lien: 'var(--amber)',
  pending: 'var(--amber)',
  assigned: 'var(--red)',
  distributed: 'var(--red)',
  unknown: 'var(--border2)',
};

export interface SurplusProperty {
  key: string;
  county: string | null;
  caseNumber: string | null;
  address: string;
  city: string;
  zip: string;
  ownerMailingStreet: string | null;
  ownerMailingCity: string | null;
  ownerMailingState: string | null;
  grossSurplus: number;
  claimStatus: string;
  claimStatusLabel: string;
  workScore: number;
  workReason: string;
  mailVerdict: string | null;
  noticeConfirmed: boolean;
  daysRemaining: number | null;
  claimantNames: string[];
  claimantCount: number;
  anyContactable: boolean;
  anyMismatch: boolean;
  anyDeceased: boolean;
  stage: string;
  claimants: any[];
}

interface Props {
  p: SurplusProperty;
  picked: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
}

export default function SurplusPropertyCard({ p, picked, onPick, onOpen }: Props) {
  const chip = STATUS_CHIP[p.claimStatus] || CHIP.slate;
  const accent = STATUS_ACCENT[p.claimStatus] || 'var(--border2)';

  // One line on reachability, in priority order: a live number is the only
  // thing that makes a lead callable today, and everything else explains why
  // there isn't one.
  const contact = p.anyContactable
    ? { icon: '☏', text: 'callable number on file', tone: 'var(--mint)' }
    : p.anyMismatch
      ? { icon: '⚠', text: 'trace returned somebody else', tone: 'var(--red)' }
      : !p.ownerMailingStreet
        ? { icon: '○', text: 'owner address not recovered', tone: 'var(--amber)' }
        : { icon: '○', text: 'not skip traced yet', tone: 'var(--faint)' };

  const ownerLine = p.ownerMailingStreet
    ? [p.ownerMailingStreet, p.ownerMailingCity, p.ownerMailingState].filter(Boolean).join(', ')
    : null;

  return (
    <div
      className={`dc-pcard${picked ? ' pick' : ''}`}
      style={{ borderLeftColor: accent }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="dc-pcard-top">
        <input
          type="checkbox"
          checked={picked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onPick(e.target.checked)}
          aria-label={`Select ${p.address}`}
        />
        <span className="dc-tag" style={{ background: chip.bg, color: chip.fg }}>
          {p.claimStatusLabel}
        </span>
        {p.anyDeceased && (
          <span className="dc-tag" style={{ background: CHIP.violet.bg, color: CHIP.violet.fg }}>
            Estate
          </span>
        )}
        <span className="dc-pcard-money">{money(p.grossSurplus)}</span>
      </div>

      <div className="dc-pcard-addr">{p.address}</div>
      <div className="dc-pcard-sub">
        {[p.city, p.zip].filter(Boolean).join(' ')} · {p.county} County
        {p.caseNumber ? ` · ${p.caseNumber}` : ''}
      </div>

      {/* The address the notice was mailed to, which is usually NOT the
          property and is where the owner actually is. */}
      {ownerLine && <div className="dc-pcard-owner">✉ {ownerLine}</div>}

      <div className="dc-pcard-names">
        {p.claimantNames.slice(0, 3).join(', ')}
        {p.claimantCount > 3 && ` +${p.claimantCount - 3} more`}
        {p.claimantCount > 1 && (
          <span className="dc-pcard-count">{p.claimantCount} owners</span>
        )}
      </div>

      <div className="dc-pcard-foot">
        <span style={{ color: contact.tone }}>
          {contact.icon} {contact.text}
        </span>
        <button
          type="button"
          className="dc-pcard-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          Work it
        </button>
      </div>
    </div>
  );
}
