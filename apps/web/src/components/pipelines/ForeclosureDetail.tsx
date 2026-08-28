'use client';

import { PanelRow, PanelSection } from './PipelineWorkPanel';
import { fmtDate, money, pct } from './format';

/**
 * What is unique about a foreclosure lead, for the work panel.
 *
 * Two things carry most of the weight and both are easy to get wrong.
 *
 * The SALE DATE is the deadline, and it is hard: after it the owner has lost
 * the house and there is nothing to buy. It leads everything.
 *
 * The equity figure is only as good as the debt figure behind it, and the rules
 * engine says outright when it is not good enough. `debtFigureReliable=false`
 * means the equity fields are deliberately BLANK, not merely unknown, and
 * showing a number there would invent one. So this renders the reason rather
 * than a dash, which is the difference between "we do not know" and "do not
 * trust this".
 *
 * Signals are the engine's reasons, kept verbatim: they are what a person reads
 * to decide whether the score means anything on this particular file.
 */
export default function ForeclosureDetail({ l }: { l: any }) {
  return (
    <>
      <PanelSection title="The deadline">
        <PanelRow
          k="Sale date"
          v={l.saleDate ? fmtDate(l.saleDate) : 'not set'}
          tone={l.daysToSale != null && l.daysToSale >= 0 && l.daysToSale <= 14 ? 'var(--red)' : undefined}
        />
        {l.daysToSale != null && (
          <PanelRow
            k="Days to sale"
            v={l.daysToSale < 0 ? `${Math.abs(l.daysToSale)} days past` : `${l.daysToSale} days`}
            tone={l.daysToSale < 0 ? 'var(--faint)' : l.daysToSale <= 14 ? 'var(--red)' : undefined}
            note={l.daysToSale < 0 ? 'The sale has happened. There is nothing left to buy here.' : undefined}
          />
        )}
        {l.hearingDate && <PanelRow k="Hearing" v={fmtDate(l.hearingDate)} />}
        <PanelRow k="Notice type" v={l.noticeType || 'unknown'} />
        {l.noticeUrl && (
          <PanelRow
            k="Notice"
            v={
              <a href={l.noticeUrl} target="_blank" rel="noopener noreferrer" className="dc-wp-link">
                open the filing
              </a>
            }
          />
        )}
      </PanelSection>

      <PanelSection title="The debt">
        {l.debtFigureReliable ? (
          <>
            <PanelRow k="Loan amount" v={money(l.loanAmount)} />
            <PanelRow k="Assessed value" v={money(l.assessedValue)} />
            <PanelRow k="Equity" v={l.equitySpread != null ? money(l.equitySpread) : 'unknown'} />
            <PanelRow k="Equity percent" v={l.equityPct != null ? pct(l.equityPct) : 'unknown'} />
          </>
        ) : (
          // Deliberately blank, not merely unknown. Filling it would invent a
          // number the rules engine has already refused to stand behind.
          <PanelRow
            k="Equity"
            v="not computed"
            tone="var(--amber)"
            note="The debt figure on this file is not reliable enough to compute equity from, so it is left blank rather than estimated. Pull the payoff before underwriting it."
          />
        )}
        <PanelRow k="Loan type" v={l.loanType || 'unknown'} />
        <PanelRow k="Lender" v={l.lenderName || 'unknown'} />
        {l.loanDate && <PanelRow k="Loan dated" v={fmtDate(l.loanDate)} />}
      </PanelSection>

      <PanelSection title="The property">
        <PanelRow k="Owner of record" v={l.ownerNames || 'unknown'} />
        {l.countyOwner && l.countyOwner !== l.ownerNames && (
          <PanelRow
            k="Owner per the county"
            v={l.countyOwner}
            note="Differs from the notice, which usually means a transfer the filing has not caught up with."
          />
        )}
        <PanelRow k="Occupancy" v={l.ownerOccupied || 'unknown'} />
        <PanelRow k="Case number" v={l.caseNumber || 'unknown'} />
        <PanelRow k="Parcel" v={l.parcelLabel || l.parcelId || 'unknown'} />
        {l.mailingAddress && (
          <PanelRow
            k="Owner mailing address"
            v={[l.mailingAddress, l.mailCity, l.mailState, l.mailZip].filter(Boolean).join(', ')}
            note={
              l.ownerOccupied === 'ABSENTEE'
                ? 'Absentee owner. This is where they actually are.'
                : undefined
            }
          />
        )}
      </PanelSection>

      {l.signals?.length > 0 && (
        <PanelSection title="Signals" note="Why the engine scored this file the way it did">
          {l.signals.map((sg: any) => (
            <div key={sg.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    color:
                      sg.severity === 'critical'
                        ? 'var(--red)'
                        : sg.severity === 'notable'
                          ? 'var(--amber)'
                          : 'var(--faint)',
                  }}
                >
                  {sg.severity}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{sg.headline}</span>
              </div>
              {/* Evidence verbatim. It is what somebody reads to decide whether
                  the score means anything on this particular file. */}
              {sg.evidence?.map((e: string, i: number) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 1 }}>
                  {e}
                </div>
              ))}
              {sg.recommendedActions?.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--mint)', marginTop: 2 }}>
                  Next: {sg.recommendedActions.join('; ')}
                </div>
              )}
            </div>
          ))}
        </PanelSection>
      )}
    </>
  );
}
