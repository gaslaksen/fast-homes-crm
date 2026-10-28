'use client';

import { useCallback, useEffect, useState } from 'react';
import { surplusAPI } from '@/lib/api';
import { contactStatusLabel } from '@/lib/surplus-people';
import { fmtDate } from './format';

/**
 * Every IDI batch that went out, and the people each one turned up.
 *
 * The list answers "what did we send and what came back". Opening a batch
 * shows each claimant it was sent for as they stand today, with every relative
 * IDI filed on their case, so the names picked for an export can be found and
 * worked again without a spreadsheet beside the board.
 */

export interface BatchRef {
  id: string;
  code: string;
}

interface BatchItem {
  id: string;
  code: string;
  fileName: string;
  createdAt: string;
  createdBy: string | null;
  rowCount: number;
  skippedCount: number;
  resultsAppliedAt: string | null;
  resultsFileName: string | null;
  matched: number;
  noContact: number;
  noPerson: number;
  waiting: number;
  deceased: number;
  relativesFiled: number;
  touchedSince: number;
}

interface Relative {
  id: string;
  name: string;
  relationship: string | null;
  phones: string[];
  emails: string[];
  place: string | null;
  deceased: boolean;
  doNotCall: boolean;
  contactStatus: string;
  lastContactedAt: string | null;
}

interface MemberRow {
  rowNumber: number;
  result: string | null;
  deceased: boolean;
  phonesReturned: number;
  emailsReturned: number;
  relativesFiled: number;
  leadId: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  stage: string | null;
  claimantDeceased: boolean;
  doNotCall: boolean;
  phoneCount: number;
  lastTouchedAt: string | null;
  relatives: Relative[];
}

const RESULT: Record<string, { label: string; color: string }> = {
  matched: { label: 'Contacts found', color: 'var(--mint)' },
  no_contact: { label: 'Found, no contacts', color: 'var(--amber, #d69e2e)' },
  no_person: { label: 'Nobody found', color: 'var(--dim)' },
  waiting: { label: 'Waiting on IDI', color: 'var(--dim)' },
};

const cell: React.CSSProperties = { padding: '8px', verticalAlign: 'top' };
const head: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600 };
const rule = '1px solid var(--line, rgba(127,127,127,.2))';

export default function SurplusBatches({
  initialBatchId,
  onClose,
  onShowOnBoard,
  onOpenClaimant,
}: {
  /** Open straight on this batch, as the IDI import does when it finishes. */
  initialBatchId?: string | null;
  onClose: () => void;
  onShowOnBoard: (batch: BatchRef) => void;
  onOpenClaimant: (leadId: string, batch: BatchRef) => void;
}) {
  const [list, setList] = useState<BatchItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialBatchId || null);
  const [detail, setDetail] = useState<{ batch: BatchItem; members: MemberRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    surplusAPI
      .batches()
      .then((res) => setList(res.data || []))
      .catch((err: any) => setError(err?.response?.data?.message || 'The batches could not be loaded.'));
  }, []);

  const load = useCallback((id: string) => {
    setDetail(null);
    setExpanded({});
    surplusAPI
      .batch(id)
      .then((res) => setDetail(res.data))
      .catch((err: any) => setError(err?.response?.data?.message || 'That batch could not be loaded.'));
  }, []);

  useEffect(() => {
    if (openId) load(openId);
  }, [openId, load]);

  const ref = detail ? { id: detail.batch.id, code: detail.batch.code } : null;

  const renderList = () => {
    if (!list) return <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading batches...</div>;
    if (!list.length) {
      return (
        <div style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.5 }}>
          No batches yet. Select claimants on the board and choose Export for IDI: each export is saved here as a
          numbered batch.
        </div>
      );
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={head}>Batch</th>
            <th style={head}>Sent</th>
            <th style={head}>Came back</th>
            <th style={head}>Relatives</th>
            <th style={head}>Worked since</th>
          </tr>
        </thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.id} style={{ borderTop: rule }}>
              <td style={cell}>
                <button
                  type="button"
                  className="dc-btn xs"
                  onClick={() => setOpenId(b.id)}
                  aria-label={`Open batch ${b.code}`}
                >
                  {b.code}
                </button>
              </td>
              <td style={cell}>
                <div>
                  {fmtDate(b.createdAt)}
                  {b.createdBy ? ` by ${b.createdBy}` : ''}
                </div>
                <div style={{ color: 'var(--dim)' }}>
                  {b.rowCount} claimant{b.rowCount === 1 ? '' : 's'}
                  {b.skippedCount ? `, ${b.skippedCount} left out` : ''}
                </div>
              </td>
              <td style={cell}>
                {b.waiting === b.rowCount ? (
                  <span style={{ color: 'var(--dim)' }}>Waiting on IDI</span>
                ) : (
                  <>
                    <div>
                      {b.matched} with contacts{b.noContact ? `, ${b.noContact} found without` : ''}
                      {b.noPerson ? `, ${b.noPerson} nobody found` : ''}
                    </div>
                    <div style={{ color: 'var(--dim)' }}>
                      {b.deceased ? `${b.deceased} deceased · ` : ''}
                      {b.waiting ? `${b.waiting} still waiting · ` : ''}
                      {b.resultsAppliedAt ? `results ${fmtDate(b.resultsAppliedAt)}` : ''}
                    </div>
                  </>
                )}
              </td>
              <td style={cell}>{b.relativesFiled}</td>
              <td style={cell}>
                {b.touchedSince} of {b.rowCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderDetail = () => {
    if (!detail) return <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading the batch...</div>;
    const b = detail.batch;
    return (
      <>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginBottom: 12, lineHeight: 1.5 }}>
          {b.fileName} · sent {fmtDate(b.createdAt)}
          {b.createdBy ? ` by ${b.createdBy}` : ''}
          {b.resultsAppliedAt ? ` · results applied ${fmtDate(b.resultsAppliedAt)}` : ' · no results applied yet'}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={head}>Row</th>
              <th style={head}>Claimant</th>
              <th style={head}>IDI returned</th>
              <th style={head}>People</th>
              <th style={head}>Last touch</th>
              <th style={head} />
            </tr>
          </thead>
          <tbody>
            {detail.members.map((m) => {
              const res = RESULT[m.result || 'waiting'] || RESULT.waiting;
              const open = !!expanded[m.rowNumber];
              return (
                <tr key={m.rowNumber} style={{ borderTop: rule }}>
                  <td style={{ ...cell, color: 'var(--dim)' }}>{m.rowNumber}</td>
                  <td style={cell}>
                    <div style={{ fontWeight: 600 }}>{m.claimant}</div>
                    <div style={{ color: 'var(--dim)' }}>
                      {[m.county, m.caseNumber, m.stage].filter(Boolean).join(' · ')}
                    </div>
                    {(m.claimantDeceased || m.doNotCall) && (
                      <div style={{ color: 'var(--red, #e53e3e)', fontSize: 11.5 }}>
                        {[m.claimantDeceased ? 'Deceased' : null, m.doNotCall ? 'Do not call' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    <div style={{ color: res.color, fontWeight: 600 }}>{res.label}</div>
                    {m.result && m.result !== 'no_person' && (
                      <div style={{ color: 'var(--dim)' }}>
                        {m.phonesReturned} phone{m.phonesReturned === 1 ? '' : 's'}, {m.emailsReturned} email
                        {m.emailsReturned === 1 ? '' : 's'}
                        {m.deceased ? ', death record' : ''}
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    <div>
                      {m.phoneCount} number{m.phoneCount === 1 ? '' : 's'} on the claimant
                    </div>
                    {m.relatives.length > 0 && (
                      <button
                        type="button"
                        className="dc-btn xs"
                        style={{ marginTop: 4 }}
                        aria-expanded={open}
                        onClick={() => setExpanded((e) => ({ ...e, [m.rowNumber]: !open }))}
                      >
                        {open ? 'Hide' : 'Show'} {m.relatives.length} relative{m.relatives.length === 1 ? '' : 's'}
                      </button>
                    )}
                    {open && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {m.relatives.map((r) => (
                          <div key={r.id} style={{ borderLeft: rule, paddingLeft: 8 }}>
                            <div style={{ fontWeight: 600 }}>
                              {r.name}
                              <span style={{ color: 'var(--dim)', fontWeight: 400 }}>
                                {r.relationship ? ` · ${r.relationship}` : ''}
                                {r.place ? ` · ${r.place}` : ''}
                              </span>
                            </div>
                            <div style={{ color: 'var(--dim)' }}>
                              {r.phones.length ? r.phones.join(', ') : 'no phone'}
                              {r.emails.length ? ` · ${r.emails.join(', ')}` : ''}
                            </div>
                            <div style={{ fontSize: 11.5, color: r.doNotCall || r.deceased ? 'var(--red, #e53e3e)' : 'var(--dim)' }}>
                              {r.deceased ? 'Deceased · ' : ''}
                              {r.doNotCall ? 'Do not call · ' : ''}
                              {contactStatusLabel(r.contactStatus)}
                              {r.lastContactedAt ? `, last ${fmtDate(r.lastContactedAt)}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={cell}>{m.lastTouchedAt ? fmtDate(m.lastTouchedAt) : <span style={{ color: 'var(--dim)' }}>None</span>}</td>
                  <td style={cell}>
                    <button type="button" className="dc-btn xs" onClick={() => ref && onOpenClaimant(m.leadId, ref)}>
                      Open case
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  };

  return (
    <div className="dc-modal" onClick={onClose}>
      <div className="dc-sheet" style={{ maxWidth: 1080, width: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {openId && (
            <button type="button" className="dc-btn xs" onClick={() => setOpenId(null)}>
              All batches
            </button>
          )}
          <div style={{ fontWeight: 700, fontSize: 17 }}>
            {openId ? `Batch ${detail?.batch.code || ''}` : 'IDI batches'}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {ref && (
              <button type="button" className="dc-btn xs pri" onClick={() => onShowOnBoard(ref)}>
                Show on the board
              </button>
            )}
            <button type="button" className="dc-btn xs" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        </div>
        {error && (
          <div style={{ color: 'var(--red, #e53e3e)', fontSize: 13, marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}
        <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>{openId ? renderDetail() : renderList()}</div>
      </div>
    </div>
  );
}
