'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';
import '@/components/pipelines/pipeline-board.css';

/**
 * The A Tier / B Tier ratings import. A docket review (Grok, or a person)
 * rates each case A, work it now, or B, a claim on file that may be denied,
 * and hands back a sheet with Rating, County and Case number columns. This
 * page reads the sheet, shows what every row would do, and writes only when
 * asked. The board's A Tier and B Tier buttons read what lands here.
 */

type Status = 'new' | 'changed' | 'same' | 'unmatched' | 'invalid' | 'conflict' | 'duplicate';

interface PreviewRow {
  row: number;
  sheet: string;
  rating: 'A' | 'B' | null;
  ratingText: string;
  county: string;
  caseNumber: string;
  reason: string | null;
  ratedBy: string | null;
  status: Status;
  current: string | null;
  leadCount: number;
  claimants: string[];
}

interface Preview {
  rows: PreviewRow[];
  summary: {
    rows: number;
    A: number;
    B: number;
    new: number;
    changed: number;
    same: number;
    unmatched: number;
    invalid: number;
    conflict: number;
    duplicate: number;
    leads: number;
  };
}

const WRITES: Status[] = ['new', 'changed', 'same'];

function whatHappens(r: PreviewRow): string {
  switch (r.status) {
    case 'new':
      return `Rated ${r.rating}`;
    case 'changed':
      return `${r.current} to ${r.rating}`;
    case 'same':
      return `Already ${r.rating}, reason refreshed`;
    case 'unmatched':
      return 'No such case in Dealcore';
    case 'invalid':
      return r.ratingText ? `"${r.ratingText}" is not A or B` : 'No rating, county or case number';
    case 'conflict':
      return 'Rated both A and B in this file, so neither is applied';
    case 'duplicate':
      return 'Repeats an earlier row';
  }
}

export default function SurplusRatingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const read = async (f: File) => {
    setFile(f);
    setPreview(null);
    setDone(null);
    setError(null);
    setBusy(true);
    try {
      const res = await surplusAPI.ratingsParse(f);
      setPreview(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await surplusAPI.ratingsImport(file);
      const s = res.data?.summary || preview.summary;
      setDone(
        `Rated ${res.data?.applied ?? 0} case${res.data?.applied === 1 ? '' : 's'}: ${s.A} A and ${s.B} B, across ${s.leads} claimant row${s.leads === 1 ? '' : 's'}.`,
      );
      setPreview(null);
      setFile(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The ratings did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const writes = preview?.rows.filter((r) => WRITES.includes(r.status)) || [];
  const problems = preview?.rows.filter((r) => !WRITES.includes(r.status)) || [];

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="dc-h1" style={{ marginTop: 4 }}>
              Import A/B ratings
            </h1>
            <div className="dc-sub" style={{ maxWidth: 720 }}>
              Upload a docket review sheet with Rating, County and Case number columns. Why this rating and Rated by
              are kept too when the sheet has them. Every claimant on a case takes its rating. Cases the sheet does not
              name keep the rating they have, so an A file and a B file can go in one after the other.
            </div>
          </div>
          <Link className="dc-or-btn" href="/surplus-funds">
            Back to the board
          </Link>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) read(f);
          }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" className="dc-or-btn on" disabled={busy} onClick={() => fileRef.current?.click()}>
            {file ? 'Choose a different file' : 'Choose a ratings file'}
          </button>
          {file && <span style={{ fontSize: 13, color: 'var(--dim)' }}>{file.name}</span>}
          {busy && <span style={{ fontSize: 13, color: 'var(--dim)' }}>Working...</span>}
        </div>

        {error && (
          <div role="alert" style={{ ...note, borderColor: 'var(--red)', color: 'var(--red)' }}>
            {error}
          </div>
        )}
        {done && (
          <div role="status" style={note}>
            {done}{' '}
            <Link href="/surplus-funds" style={{ color: 'var(--mint)', fontWeight: 600 }}>
              See them on the board
            </Link>
          </div>
        )}

        {preview && (
          <>
            <div style={{ ...note, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                <b>{writes.length}</b> case{writes.length === 1 ? '' : 's'} will be rated: <b>{preview.summary.A}</b> A and{' '}
                <b>{preview.summary.B}</b> B, covering {preview.summary.leads} claimant row
                {preview.summary.leads === 1 ? '' : 's'}.
                {problems.length > 0 && (
                  <>
                    {' '}
                    <b style={{ color: 'var(--red)' }}>{problems.length}</b> row{problems.length === 1 ? '' : 's'} will be
                    left out.
                  </>
                )}
              </span>
              <button
                type="button"
                className="dc-or-btn on"
                style={{ marginLeft: 'auto' }}
                disabled={busy || !writes.length}
                onClick={apply}
              >
                Apply {writes.length} rating{writes.length === 1 ? '' : 's'}
              </button>
            </div>

            {problems.length > 0 && (
              <RowTable
                title="Left out"
                sub="Nothing is written for these. A case Dealcore does not hold usually means the county list has not been imported or the case number is written differently."
                rows={problems}
              />
            )}
            {writes.length > 0 && <RowTable title="Will be rated" rows={writes} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

function RowTable({ title, sub, rows }: { title: string; sub?: string; rows: PreviewRow[] }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
        {title} <span style={{ color: 'var(--dim)', fontSize: 13, fontWeight: 400 }}>{rows.length}</span>
      </h2>
      {sub && <div style={{ color: 'var(--dim)', fontSize: 13, marginTop: 4 }}>{sub}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--dim)' }}>
              <th style={th}>Row</th>
              <th style={th}>Rating</th>
              <th style={th}>Case</th>
              <th style={th}>Claimants in Dealcore</th>
              <th style={th}>What happens</th>
              <th style={th}>Why this rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.sheet}-${r.row}`} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, color: 'var(--faint)' }}>{r.row}</td>
                <td style={td}>
                  <b>{r.rating || r.ratingText || ''}</b>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {r.county} {r.caseNumber}
                </td>
                <td style={td}>
                  {r.claimants.length ? r.claimants.join(', ') : <span style={{ color: 'var(--faint)' }}>None</span>}
                  {r.leadCount > r.claimants.length && (
                    <span style={{ color: 'var(--faint)' }}> +{r.leadCount - r.claimants.length} more</span>
                  )}
                </td>
                <td style={td}>{whatHappens(r)}</td>
                <td style={{ ...td, color: 'var(--dim)', maxWidth: 420 }}>
                  {r.reason}
                  {r.ratedBy && <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>{r.ratedBy}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const note: React.CSSProperties = {
  marginTop: 14,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  fontSize: 13,
};
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '7px 8px', verticalAlign: 'top' };
