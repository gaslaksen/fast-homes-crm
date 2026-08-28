'use client';

import { PanelRow, PanelSection } from './PipelineWorkPanel';
import {
  METHOD_LABEL,
  OCCUPANCY_LABEL,
  TAX_STAGE_LABEL,
  WORK_STATUS_LABEL,
  fmtDate,
  money,
  pct,
} from './format';

/**
 * What is unique about a tax sale, for the work panel.
 *
 * The number that decides a tax sale deal is the REDEMPTION PAYOFF, not the
 * loan debt and not the assessed value: the owner can pay it at any time before
 * confirmation and withdraw the property, so it is both the price of the deal
 * and the thing that can end it. It leads.
 *
 * Two tracks that must never be conflated, because they run on different
 * statutes and produce different deeds: In Rem under NCGS 105-375 ends in a
 * Sheriff's Deed, Judicial under NCGS 105-374 in a Commissioner's Deed. The
 * panel names the statute rather than leaving somebody to infer it.
 *
 * Two clocks, and the upset window is the sharp one: any bid restarts it, so a
 * sale is not final on the sale date.
 */
export default function TaxSaleDetail({ r }: { r: any }) {
  return (
    <>
      <PanelSection title="The payoff">
        <PanelRow
          k="Redemption amount"
          v={money(r.redemptionAmount)}
          tone="var(--mint)"
          note="What the owner pays to withdraw the property. This is the number the deal turns on, not the taxes owed."
        />
        <PanelRow k="Taxes owed" v={money(r.taxesOwed)} />
        {r.payoffExtras > 0 && <PanelRow k="Costs and fees on top" v={money(r.payoffExtras)} />}
        <PanelRow k="Assessed value" v={money(r.assessedValue)} />
        <PanelRow k="Equity" v={`${money(r.equity)} (${pct(r.equityPct)})`} />
        <PanelRow k="Net after costs" v={money(r.netAfterCosts)} />
      </PanelSection>

      <PanelSection title="The sale">
        <PanelRow k="Track" v={`${METHOD_LABEL[r.method] || r.method} · ${r.statute}`} note={`Ends in a ${r.deedType}.`} />
        <PanelRow k="Stage" v={TAX_STAGE_LABEL[r.stage] || r.stage} />
        <PanelRow k="Sale date" v={r.saleDate ? fmtDate(r.saleDate) : 'not set'} />
        {r.daysToSale != null && (
          <PanelRow
            k="Days to sale"
            v={r.daysToSale < 0 ? `${Math.abs(r.daysToSale)} days past` : `${r.daysToSale} days`}
            tone={r.daysToSale != null && r.daysToSale <= 14 ? 'var(--red)' : undefined}
          />
        )}
        <PanelRow
          k="Upset bid deadline"
          v={r.upsetDeadline ? fmtDate(r.upsetDeadline) : 'not set'}
          note="Any upset bid restarts this window, so a sale is not final on the sale date."
        />
        {r.daysToUpset != null && (
          <PanelRow
            k="Days left to upset"
            v={r.daysToUpset < 0 ? `closed ${Math.abs(r.daysToUpset)} days ago` : `${r.daysToUpset} days`}
            tone={r.daysToUpset != null && r.daysToUpset >= 0 && r.daysToUpset <= 3 ? 'var(--red)' : undefined}
          />
        )}
      </PanelSection>

      <PanelSection title="Bidding">
        <PanelRow k="Opening bid" v={money(r.openingBid)} />
        <PanelRow k="Current bid" v={money(r.currentBid)} />
        <PanelRow k="Next upset bid" v={money(r.nextUpsetBid)} note="The minimum a competing bid must reach." />
        {r.depositPct != null && <PanelRow k="Deposit required" v={pct(r.depositPct)} />}
      </PanelSection>

      <PanelSection title="Encumbrances and title">
        <PanelRow k="Years behind" v={String(r.yearsBehind || 0)} />
        {r.delinquentYears?.length > 0 && (
          <PanelRow k="Delinquent years" v={r.delinquentYears.join(', ')} />
        )}
        <PanelRow k="City taxes outstanding" v={r.cityTaxes ? 'Yes' : 'No'} />
        <PanelRow
          k="Mortgage of record"
          v={r.hasMortgage ? 'Yes' : 'No'}
          note={r.hasMortgage ? 'A lender can redeem too, not only the owner.' : undefined}
        />
        <PanelRow
          k="IRS lien"
          v={r.hasIrsLien ? 'Yes' : 'No'}
          note={r.hasIrsLien ? 'The federal right of redemption runs 120 days past the sale.' : undefined}
        />
      </PanelSection>

      <PanelSection title="The property">
        <PanelRow k="Owner of record" v={r.owner} />
        <PanelRow k="Occupancy" v={OCCUPANCY_LABEL[r.occupancy] || 'Unknown'} />
        <PanelRow k="Parcel" v={r.parcelId || 'unknown'} />
        <PanelRow k="File number" v={r.fileNumber || 'unknown'} />
        {r.filedBy && <PanelRow k="Filed by" v={r.filedBy} />}
        <PanelRow k="Work status" v={WORK_STATUS_LABEL[r.workStatus] || r.workStatus} />
      </PanelSection>
    </>
  );
}
