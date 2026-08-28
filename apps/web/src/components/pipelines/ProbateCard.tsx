'use client';

import { CHIP, money } from './format';
import { WORK_STATUS_LABELS, type ProbateContact } from '@/components/probate/ProbateContactRow';

/**
 * One heir on the board.
 *
 * The unit is a PERSON, not a property, which is what makes probate different
 * from every other pipeline here. One heir can inherit several properties
 * across several estates; the card says how many and what they are worth in
 * total, and the properties themselves live in the panel.
 *
 * Months since death leads because it is the only clock probate has, and it
 * cuts both ways: too soon is intrusive, too late and the estate is already
 * settled or listed.
 */

export const PROBATE_ACCENT: Record<string, string> = {
  NOT_CONTACTED: 'var(--mint)',
  IN_CONVERSATION: 'var(--amber)',
  APPOINTMENT_SET: 'var(--amber)',
  UNDER_CONTRACT: 'var(--mint)',
  DEAD: 'var(--border2)',
};

const STATUS_CHIP: Record<string, { fg: string; bg: string }> = {
  NOT_CONTACTED: CHIP.slate,
  IN_CONVERSATION: CHIP.amber,
  APPOINTMENT_SET: CHIP.violet,
  UNDER_CONTRACT: CHIP.mint,
  DEAD: CHIP.slate,
};

interface Props {
  c: ProbateContact;
  picked: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
}

export default function ProbateCard({ c, picked, onPick, onOpen }: Props) {
  const status = c.workStatus || 'NOT_CONTACTED';
  const chip = STATUS_CHIP[status] || CHIP.slate;

  const contact = c.doNotCall
    ? { text: 'do not call', tone: 'var(--red)' }
    : c.phone
      ? { text: `☏ ${c.phoneType || 'phone'} on file`, tone: 'var(--mint)' }
      : { text: 'no number', tone: 'var(--faint)' };

  return (
    <div
      className={`dc-pcard${picked ? ' pick' : ''}`}
      style={{ borderLeftColor: PROBATE_ACCENT[status] || 'var(--border2)' }}
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
          aria-label={`Select ${c.heirName}`}
        />
        <span className="dc-tag" style={{ background: chip.bg, color: chip.fg }}>
          {WORK_STATUS_LABELS[status] || 'Not contacted'}
        </span>
        {c.absenteeHeir && (
          <span className="dc-tag" style={{ background: CHIP.blue.bg, color: CHIP.blue.fg }}>
            Absentee
          </span>
        )}
        <span className="dc-pcard-money">{money(c.totalValue)}</span>
      </div>

      <div className="dc-pcard-addr">{c.heirName}</div>
      <div className="dc-pcard-sub">
        {c.heirCity || 'city unknown'}
        {c.monthsSinceDeath != null ? ` · ${c.monthsSinceDeath} months since death` : ''}
      </div>

      <div className="dc-pcard-names">
        {c.deceasedNames.slice(0, 2).join(', ') || 'decedent unknown'}
        {c.propertyCount > 1 && (
          <span className="dc-pcard-count">{c.propertyCount} properties</span>
        )}
      </div>

      <div className="dc-pcard-foot">
        <span style={{ color: contact.tone }}>{contact.text}</span>
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
