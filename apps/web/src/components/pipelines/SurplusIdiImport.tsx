'use client';

import { useEffect, useMemo, useState } from 'react';
import { surplusAPI } from '@/lib/api';

/**
 * Apply an IDI batch results file to the board.
 *
 * IDI returns one row per person we sent and echoes only the name and address,
 * so every row is matched back to a claimant here before anything is written.
 * The match is shown, can be changed or left out, and only then applied.
 */

interface PreviewOption {
  leadId: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  addressMatch: boolean;
}

interface PreviewRow {
  index: number;
  input: { first: string; last: string; street: string; city: string; state: string; zip: string };
  found: boolean;
  deceased: 'Y' | 'N' | 'U';
  phones: number;
  emails: number;
  relatives: number;
  confidence: 'name_and_address' | 'name_only' | 'ambiguous' | 'none';
  leadId: string | null;
  options: PreviewOption[];
  sharedWith: number[];
}

const CONFIDENCE: Record<PreviewRow['confidence'], { label: string; color: string }> = {
  name_and_address: { label: 'Name and address match', color: 'var(--mint)' },
  name_only: { label: 'Name matches, address differs', color: 'var(--amber, #d69e2e)' },
  ambiguous: { label: 'More than one claimant fits. Pick one', color: 'var(--amber, #d69e2e)' },
  none: { label: 'No claimant with this name', color: 'var(--dim)' },
};

export default function SurplusIdiImport({
  file,
  onClose,
  onDone,
}: {
  file: File;
  onClose: () => void;
  /** Called after a successful apply with a one line summary for the toast. */
  onDone: (summary: string) => void;
}) {
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    surplusAPI
      .idiImportParse(file)
      .then((res) => {
        if (!live) return;
        const r: PreviewRow[] = res.data.rows || [];
        setRows(r);
        setChoice(Object.fromEntries(r.map((row) => [row.index, row.leadId || ''])));
      })
      .catch((err: any) => live && setError(err?.response?.data?.message || 'That file could not be read.'))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [file]);

  const toApply = useMemo(() => (rows || []).filter((r) => choice[r.index]).length, [rows, choice]);

  // Two rows pointed at one claimant is almost always a mistake: the second
  // overwrites the first's numbers.
  const clash = useMemo(() => {
    const seen = new Map<string, number>();
    const out = new Set<number>();
    for (const r of rows || []) {
      const id = choice[r.index];
      if (!id) continue;
      if (seen.has(id)) {
        out.add(r.index);
        out.add(seen.get(id)!);
      } else seen.set(id, r.index);
    }
    return out;
  }, [rows, choice]);

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const assignments = Object.fromEntries(rows.map((r) => [String(r.index), choice[r.index] || null]));
      const res = await surplusAPI.idiImportExecute(file, assignments);
      const d = res.data;
      const parts = [
        `IDI results applied to ${d.applied} claimant${d.applied === 1 ? '' : 's'}`,
        d.withContact ? `${d.withContact} with new contacts` : null,
        d.deceased ? `${d.deceased} marked deceased` : null,
        d.noMatch ? `${d.noMatch} no match` : null,
        d.relativesFiled ? `${d.relativesFiled} relative${d.relativesFiled === 1 ? '' : 's'} filed` : null,
        d.skipped?.length ? `${d.skipped.length} left out` : null,
        d.errors?.length ? `${d.errors.length} failed` : null,
      ].filter(Boolean);
      onDone(`${parts.join(', ')}.`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'The results could not be applied.');
      setBusy(false);
    }
  };

  return (
    <div className="dc-modal" onClick={onClose}>
      <div className="dc-sheet" style={{ maxWidth: 1080, width: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Import IDI results</div>
          <button className="dc-btn xs" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div style={{ color: 'var(--dim)', fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
          {file.name}. Check each row is going to the right claimant, then apply. Phones are merged newest first, a
          death flag marks the claimant deceased, and relatives are filed as relatives, never heirs. IDI does not
          check numbers against the Do Not Call registries, so new numbers show as unscrubbed.
        </div>

        {error && (
          <div style={{ color: 'var(--red, #e53e3e)', fontSize: 13, marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}
        {busy && !rows && <div style={{ color: 'var(--dim)', fontSize: 13 }}>Reading the file...</div>}

        {rows && (
          <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--dim)' }}>
                  <th style={{ padding: '6px 8px' }}>Sent to IDI</th>
                  <th style={{ padding: '6px 8px' }}>IDI returned</th>
                  <th style={{ padding: '6px 8px', minWidth: 300 }}>Apply to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const conf = CONFIDENCE[r.confidence];
                  return (
                    <tr key={r.index} style={{ borderTop: '1px solid var(--line, rgba(127,127,127,.2))', verticalAlign: 'top' }}>
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {r.input.first} {r.input.last}
                        </div>
                        <div style={{ color: 'var(--dim)' }}>
                          {r.input.street}, {r.input.city} {r.input.state} {r.input.zip}
                        </div>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {!r.found ? (
                          <span style={{ color: 'var(--dim)' }}>No match</span>
                        ) : (
                          <>
                            {r.deceased === 'Y' && (
                              <div style={{ color: 'var(--red, #e53e3e)', fontWeight: 600 }}>Deceased</div>
                            )}
                            <div>
                              {r.phones} phone{r.phones === 1 ? '' : 's'}, {r.emails} email{r.emails === 1 ? '' : 's'},{' '}
                              {r.relatives} relative{r.relatives === 1 ? '' : 's'}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select
                          className="dc-in"
                          value={choice[r.index] || ''}
                          onChange={(e) => setChoice((c) => ({ ...c, [r.index]: e.target.value }))}
                          style={{ width: '100%', fontSize: 12.5 }}
                          aria-label={`Claimant for ${r.input.first} ${r.input.last}`}
                        >
                          <option value="">Leave out</option>
                          {r.options.map((o) => (
                            <option key={o.leadId} value={o.leadId}>
                              {o.claimant} · {o.county || 'county?'} {o.caseNumber || ''}
                              {o.addressMatch ? ' · address matches' : ''}
                            </option>
                          ))}
                        </select>
                        <div style={{ color: conf.color, fontSize: 11.5, marginTop: 4 }}>{conf.label}</div>
                        {clash.has(r.index) && (
                          <div style={{ color: 'var(--red, #e53e3e)', fontSize: 11.5, marginTop: 2 }}>
                            Another row is going to the same claimant.
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
          {rows && (
            <span style={{ color: 'var(--dim)', fontSize: 12.5 }}>
              {toApply} of {rows.length} row{rows.length === 1 ? '' : 's'} will be applied
            </span>
          )}
          <button className="dc-btn" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={busy && !!rows}>
            Cancel
          </button>
          <button className="dc-btn pri" onClick={apply} disabled={busy || !toApply || clash.size > 0}>
            {busy && rows ? 'Applying...' : `Apply ${toApply}`}
          </button>
        </div>
      </div>
    </div>
  );
}
