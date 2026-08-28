'use client';

import { CHIP, METHOD_LABEL, PRIORITY, TAX_STAGE_COLOR, TAX_STAGE_LABEL, money } from './format';

/**
 * One tax sale on the board.
 *
 * Same four questions as the surplus card, asked in tax sale terms: how close
 * is the clock, what does it cost to take, whose is it, and can we reach them.
 * Everything else lives in the work panel.
 *
 * The clock leads here rather than the money, because a tax sale is a deadline
 * before it is a price: the owner can redeem right up to confirmation, and an
 * upset bid restarts the window. A cheap parcel whose sale is next week is
 * worth more attention than an expensive one three months out.
 */

export const TAX_ACCENT: Record<string, string> = {
  UPSET_BID_PERIOD: 'var(--red)',
  SALE_SCHEDULED: 'var(--amber)',
  JUDGMENT_DOCKETED: 'var(--border2)',
  REDEEMED: 'var(--mint)',
};

interface Props {
  r: any;
  picked: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
}

export default function TaxSaleCard({ r, picked, onPick, onOpen }: Props) {
  const stage = TAX_STAGE_COLOR[r.stage] || CHIP.slate;
  const prio = PRIORITY[r.priority];

  // Whichever clock is actually running. The upset window is the sharp one:
  // once it is open, a competing bid can take the property away in days.
  const clock =
    r.daysToUpset != null && r.daysToUpset >= 0
      ? { label: `${r.daysToUpset}d to upset`, tone: r.daysToUpset <= 3 ? 'var(--red)' : 'var(--amber)' }
      : r.daysToSale != null
        ? {
            label: r.daysToSale < 0 ? `sold ${Math.abs(r.daysToSale)}d ago` : `${r.daysToSale}d to sale`,
            tone: r.daysToSale >= 0 && r.daysToSale <= 14 ? 'var(--red)' : 'var(--dim)',
          }
        : { label: 'no date set', tone: 'var(--faint)' };

  const contact = r.doNotCall
    ? { text: 'do not call', tone: 'var(--red)' }
    : r.cleanPhoneCount > 0
      ? { text: `${r.cleanPhoneCount} callable`, tone: 'var(--mint)' }
      : { text: 'no number', tone: 'var(--faint)' };

  return (
    <div
      className={`dc-pcard${picked ? ' pick' : ''}`}
      style={{ borderLeftColor: TAX_ACCENT[r.stage] || 'var(--border2)' }}
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
          aria-label={`Select ${r.address}`}
        />
        <span className="dc-tag" style={{ background: stage.bg, color: stage.fg }}>
          {TAX_STAGE_LABEL[r.stage] || r.stage}
        </span>
        {prio && (
          <span className="dc-tag" style={{ background: prio.bg, color: prio.fg }}>
            {prio.label}
          </span>
        )}
        <span className="dc-pcard-money">{money(r.redemptionAmount)}</span>
      </div>

      <div className="dc-pcard-addr">{r.address}</div>
      <div className="dc-pcard-sub">
        {[r.city, r.zip].filter(Boolean).join(' ')} · {r.county} County ·{' '}
        {METHOD_LABEL[r.method] || r.method}
      </div>

      <div className="dc-pcard-names">{r.owner}</div>

      <div className="dc-pcard-foot">
        <span style={{ color: clock.tone }}>⏱ {clock.label}</span>
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
