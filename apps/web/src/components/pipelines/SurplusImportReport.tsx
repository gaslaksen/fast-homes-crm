'use client';

/**
 * What a list import did, in the four buckets the list rules ask for: New,
 * Already on file, Previously ruled out, Paid out. It used to be a toast with
 * three names per bucket, which was gone before anyone could act on it, and
 * the bots' lists are exactly where a re-researched dead case comes from.
 *
 * A row that matched under a different spelling of the claimant says what it
 * matched, so a wrong match can be caught and the row added by hand.
 */

interface ReportRow {
  row: number;
  leadId?: string | null;
  claimant: string;
  caseNumber: string | null;
  variantOf?: string;
}

export interface SurplusImportResult {
  created: number;
  duplicates: number;
  alreadyOnFile?: (ReportRow & { stage: string | null })[];
  previouslyDead?: (ReportRow & { reason: string | null; deadAt: string | null })[];
  previouslyDeleted?: (ReportRow & { deletedAt: string | null })[];
  paidOut?: (ReportRow & { why: string })[];
  nameVariants?: number;
  belowFloor: number;
  contactMismatches?: { row: number; claimant: string; returned: string }[];
  countyInferred?: number;
  errors?: { row: number; reason: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function fmtDay(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

function Tile({ label, value, note, tone }: { label: string; value: number; note: string; tone?: 'good' | 'warn' }) {
  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--dim)', fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: tone === 'good' && value ? 'var(--mint)' : tone === 'warn' && value ? 'var(--amber)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{note}</div>
    </div>
  );
}

function Rows({ title, rows }: { title: string; rows: { r: ReportRow; detail: string }[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
        {title} <span style={{ color: 'var(--dim)', fontWeight: 400 }}>{rows.length}</span>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <tbody>
            {rows.map(({ r, detail }) => (
              <tr key={`${title}-${r.row}`} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                <td style={{ padding: '7px 10px', color: 'var(--faint)', width: 64, whiteSpace: 'nowrap' }}>Row {r.row}</td>
                <td style={{ padding: '7px 10px', minWidth: 0 }}>
                  {r.leadId ? (
                    <a
                      href={`/surplus-funds?lead=${encodeURIComponent(r.leadId)}`}
                      target="_blank"
                      rel="noopener"
                      style={{ color: 'var(--mint)', fontWeight: 600, textDecoration: 'underline' }}
                    >
                      {r.claimant}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{r.claimant}</span>
                  )}
                  {r.caseNumber && <span style={{ color: 'var(--dim)' }}> · {r.caseNumber}</span>}
                  {r.variantOf && (
                    <div style={{ color: 'var(--dim)', fontSize: 11.5 }}>
                      Matched as {r.variantOf}, a different spelling on the same case
                    </div>
                  )}
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--dim)' }}>{detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SurplusImportReport({
  fileName,
  result: r,
  floorLabel,
  onClose,
}: {
  fileName: string;
  result: SurplusImportResult;
  /** "$5,000", for the below-the-floor line. */
  floorLabel: string;
  onClose: () => void;
}) {
  const onFile = r.alreadyOnFile || [];
  const dead = r.previouslyDead || [];
  const deleted = r.previouslyDeleted || [];
  const paid = r.paidOut || [];
  const ruledOut = dead.length + deleted.length;
  const mismatches = r.contactMismatches || [];
  const errors = r.errors || [];

  return (
    <div className="dc-modal" onClick={onClose}>
      <div className="dc-sheet" style={{ maxWidth: 860, width: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Import report</div>
          <button className="dc-btn xs" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div style={{ color: 'var(--dim)', fontSize: 12.5, marginBottom: 14 }}>{fileName}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <Tile label="New" value={r.created} note="added to the board" tone="good" />
          <Tile label="Already on file" value={onFile.length} note="still being worked" />
          <Tile label="Previously ruled out" value={ruledOut} note="marked dead or deleted" tone="warn" />
          <Tile label="Paid out" value={paid.length} note="the money has gone" />
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 12, lineHeight: 1.6 }}>
          {[
            r.nameVariants ? `${plural(r.nameVariants, 'row')} matched a claimant spelled differently on the same case, so no duplicate was made.` : null,
            r.belowFloor ? `${plural(r.belowFloor, 'row')} under the ${floorLabel} floor left out.` : null,
            mismatches.length
              ? `${plural(mismatches.length, 'skip trace')} came back as a different person, so those contacts were discarded.`
              : null,
            r.countyInferred ? `${plural(r.countyInferred, 'row')} had no county and took the rest of the file's.` : null,
          ]
            .filter(Boolean)
            .map((t) => (
              <div key={t as string}>{t}</div>
            ))}
        </div>

        <Rows
          title="Previously ruled out"
          rows={[
            ...dead.map((x) => ({
              r: x,
              detail: [x.reason || 'Marked dead', fmtDay(x.deadAt)].filter(Boolean).join(', '),
            })),
            ...deleted.map((x) => ({
              r: x,
              detail: `Deleted by hand${x.deletedAt ? ` ${fmtDay(x.deletedAt)}` : ''}, not brought back`,
            })),
          ].sort((a, b) => a.r.row - b.r.row)}
        />
        <Rows title="Paid out" rows={paid.map((x) => ({ r: x, detail: x.why === 'paid to our client' ? 'Paid to our client' : 'The county paid it out' }))} />
        <Rows title="Already on file" rows={onFile.map((x) => ({ r: x, detail: x.stage || 'On the board' }))} />
        <Rows
          title="Skipped rows"
          rows={errors.map((e) => ({ r: { row: e.row, claimant: '', caseNumber: null }, detail: e.reason }))}
        />

        <div style={{ display: 'flex', marginTop: 18 }}>
          <button className="dc-btn pri" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
