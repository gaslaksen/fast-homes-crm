'use client';

import { PanelRow, PanelSection } from './PipelineWorkPanel';
import { money } from './format';
import { WORK_STATUS_LABELS, type ProbateContact } from '@/components/probate/ProbateContactRow';

/**
 * What is unique about a probate lead, for the work panel.
 *
 * Probate is the one pipeline whose unit is a PERSON, not a property. One heir
 * can inherit several properties across several estates, and the whole reason
 * the board groups by heir is that treating each property as its own lead texts
 * the same grieving person once per house. So the properties are listed inside
 * the person rather than the other way round.
 *
 * Months since death leads. It is the closest thing probate has to a clock, and
 * it cuts both ways: too soon is intrusive and usually unproductive, too late
 * and the estate has already been settled or listed with an agent.
 */
export default function ProbateDetail({ c }: { c: ProbateContact }) {
  return (
    <>
      <PanelSection title="The estate">
        <PanelRow
          k="Months since death"
          v={c.monthsSinceDeath == null ? 'unknown' : `${c.monthsSinceDeath}`}
          tone={c.monthsSinceDeath != null && c.monthsSinceDeath < 3 ? 'var(--amber)' : undefined}
          note={
            c.monthsSinceDeath != null && c.monthsSinceDeath < 3
              ? 'Recent. Approaching this early is intrusive and rarely productive.'
              : undefined
          }
        />
        <PanelRow k="Deceased" v={c.deceasedNames.join(', ') || 'unknown'} />
        <PanelRow k="Case numbers" v={c.caseNumbers.join(', ') || 'unknown'} />
        <PanelRow k="Earliest filed" v={c.earliestFiled || 'unknown'} />
      </PanelSection>

      <PanelSection title="The heir">
        <PanelRow k="Name" v={c.heirName} />
        <PanelRow k="City" v={c.heirCity || 'unknown'} />
        <PanelRow
          k="Lives elsewhere"
          v={c.absenteeHeir ? 'Yes' : 'No'}
          note={
            c.absenteeHeir
              ? 'An out of area heir carries the property remotely, which is usually why they sell.'
              : undefined
          }
        />
        <PanelRow k="Work status" v={WORK_STATUS_LABELS[c.workStatus || ''] || 'Not contacted'} />
        {c.enrolledCampaigns.length > 0 && (
          <PanelRow k="On campaigns" v={c.enrolledCampaigns.join(', ')} />
        )}
      </PanelSection>

      <PanelSection
        title="Properties"
        note={`${c.propertyCount} inherited · ${money(c.totalValue)} total`}
      >
        {/* Listed inside the person on purpose. One heir can inherit several
            properties across several estates, and treating each as its own lead
            texts the same grieving person once per house. */}
        {c.properties.map((p) => (
          <div
            key={p.leadId}
            style={{
              padding: '7px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{p.address}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{money(p.estValue)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
              {[p.city, p.zip].filter(Boolean).join(' ')}
              {p.caseNumber ? ` · ${p.caseNumber}` : ''}
              {p.deceasedName ? ` · ${p.deceasedName}` : ''}
              {p.primaryContact ? ' · primary contact' : ''}
            </div>
            {p.whyThisLead && (
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 2 }}>{p.whyThisLead}</div>
            )}
          </div>
        ))}
      </PanelSection>
    </>
  );
}
