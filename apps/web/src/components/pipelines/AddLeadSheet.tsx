'use client';

import { useState } from 'react';

export interface AddLeadField {
  key: string;
  label: string;
  required?: boolean;
  /** Stripped of $ and commas and sent as a number. */
  numeric?: boolean;
  /** Spans the full width of the two-column grid. */
  wide?: boolean;
  placeholder?: string;
}

interface Props {
  title: string;
  /** Why this lead can only ever show up in this one pipeline. */
  note: string;
  fields: AddLeadField[];
  submitting?: boolean;
  onAdd: (values: Record<string, string | number>) => void;
  onClose: () => void;
}

/**
 * One lead, typed at the source. The record is filed against a single
 * Lead.source, so a tax sale can never surface under Surplus Funds and vice
 * versa, which is what the note under the title is telling the user.
 */
export default function AddLeadSheet({ title, note, fields, submitting, onAdd, onClose }: Props) {
  const [v, setV] = useState<Record<string, string>>({});

  const required = fields.filter((f) => f.required);
  const ready = required.every((f) => (v[f.key] || '').trim());

  const submit = () => {
    const out: Record<string, string | number> = {};
    for (const f of fields) {
      const raw = (v[f.key] || '').trim();
      if (!raw) continue;
      if (f.numeric) {
        const n = Number(raw.replace(/[$,\s]/g, ''));
        out[f.key] = isNaN(n) ? raw : n;
      } else {
        out[f.key] = raw;
      }
    }
    onAdd(out);
  };

  return (
    <div className="dc-modal" onClick={onClose}>
      <div
        className="dc-sheet"
        style={{ maxWidth: 520, padding: 22 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
          <button className="dc-btn xs" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ color: 'var(--dim)', fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>{note}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {fields.map((f) => (
            <label key={f.key} style={{ display: 'block', gridColumn: f.wide ? '1 / -1' : 'auto' }}>
              <div className="dc-lbl" style={{ marginBottom: 5 }}>
                {f.label}
                {f.required ? ' *' : ''}
              </div>
              <input
                className="dc-in"
                value={v[f.key] || ''}
                placeholder={f.placeholder}
                style={{ fontSize: 12.5, padding: '8px 10px' }}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button className="dc-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="dc-btn pri"
            disabled={!ready || submitting}
            onClick={submit}
            title={ready ? '' : `${required.map((f) => f.label).join(' and ')} required`}
          >
            {submitting ? 'Adding...' : 'Add lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const TAX_SALE_FIELDS: AddLeadField[] = [
  { key: 'address', label: 'Address', required: true, wide: true },
  { key: 'city', label: 'City' },
  { key: 'zip', label: 'Zip' },
  { key: 'county', label: 'County' },
  { key: 'owner', label: 'Owner' },
  { key: 'parcelId', label: 'Parcel ID' },
  { key: 'fileNumber', label: 'File number' },
  { key: 'saleDate', label: 'Sale date', placeholder: 'YYYY-MM-DD' },
  { key: 'assessedValue', label: 'Assessed value', numeric: true },
  { key: 'taxesOwed', label: 'Taxes owed', numeric: true },
  { key: 'redemptionAmount', label: 'Redemption payoff', numeric: true },
];

export const SURPLUS_FIELDS: AddLeadField[] = [
  { key: 'claimant', label: 'Claimant', required: true, wide: true },
  { key: 'address', label: 'Address', wide: true },
  { key: 'city', label: 'City' },
  { key: 'county', label: 'County' },
  { key: 'caseNumber', label: 'Case number' },
  { key: 'parcelId', label: 'Parcel ID' },
  { key: 'grossSurplus', label: 'Gross surplus', required: true, numeric: true },
  { key: 'noticeDate', label: 'Notice date', placeholder: 'YYYY-MM-DD' },
  { key: 'salePrice', label: 'Sale price', numeric: true },
];
