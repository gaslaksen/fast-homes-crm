'use client';

import { CHIP, PRIORITY, money } from './format';

/**
 * One foreclosure on the board.
 *
 * The sale date leads and everything else follows it. A foreclosure is a hard
 * deadline: after the sale the owner has lost the house and there is nothing
 * left to buy, so a file with fourteen days on it outranks a bigger one with
 * ninety, and a past-dated one is dead weight however good it looked.
 *
 * Equity is shown only when the rules engine stands behind the debt figure.
 * Where it does not, the card says so rather than printing a number nobody
 * should act on.
 */

export const FCL_ACCENT: Record<string, string> = {
  HIGH: 'var(--red)',
  MEDIUM: 'var(--amber)',
  LOW: 'var(--border2)',
};

interface Props {
  l: any;
  picked: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
}

export default function ForeclosureCard({ l, picked, onPick, onOpen }: Props) {
  const prio = PRIORITY[l.priority] || CHIP.slate;
  const past = l.daysToSale != null && l.daysToSale < 0;

  const contact = l.doNotCall
    ? { text: 'do not call', tone: 'var(--red)' }
    : l.phone1
      ? { text: '☏ number on file', tone: 'var(--mint)' }
      : { text: 'no number', tone: 'var(--faint)' };

  return (
    <div
      className={`dc-pcard${picked ? ' pick' : ''}`}
      style={{ borderLeftColor: FCL_ACCENT[l.priority] || 'var(--border2)', opacity: past ? 0.65 : 1 }}
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
          aria-label={`Select ${l.address}`}
        />
        <span
          className="dc-tag"
          style={{ background: (prio as any).bg, color: (prio as any).fg }}
        >
          {(prio as any).label || l.priority}
        </span>
        {l.signals?.some((s: any) => s.severity === 'critical') && (
          <span className="dc-tag" style={{ background: CHIP.red.bg, color: CHIP.red.fg }}>
            Critical signal
          </span>
        )}
        <span className="dc-pcard-money">
          {l.debtFigureReliable && l.equitySpread != null ? money(l.equitySpread) : '-'}
        </span>
      </div>

      <div className="dc-pcard-addr">{l.address}</div>
      <div className="dc-pcard-sub">
        {[l.city, l.zip].filter(Boolean).join(' ')} · {l.county} County
        {l.caseNumber ? ` · ${l.caseNumber}` : ''}
      </div>

      <div className="dc-pcard-names">{l.ownerNames || 'owner unknown'}</div>

      {!l.debtFigureReliable && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          Equity not computed, the debt figure is unreliable
        </div>
      )}

      <div className="dc-pcard-foot">
        <span
          style={{
            color: past ? 'var(--faint)' : l.daysToSale != null && l.daysToSale <= 14 ? 'var(--red)' : 'var(--dim)',
          }}
        >
          ⏱{' '}
          {l.daysToSale == null
            ? 'no sale date'
            : past
              ? `sold ${Math.abs(l.daysToSale)}d ago`
              : `${l.daysToSale}d to sale`}
        </span>
        <span style={{ color: contact.tone, marginLeft: 'auto', marginRight: 8 }}>{contact.text}</span>
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
