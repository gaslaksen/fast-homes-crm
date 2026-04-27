'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { dispoAPI } from '@/lib/api';
import { DispoSummaryV2 } from './types';
import ProfitSummarySticky from './sections/ProfitSummarySticky';
import AcquisitionSection from './sections/AcquisitionSection';
import DispositionPlanSection from './sections/DispositionPlanSection';
import CostsSection from './sections/CostsSection';
import FinalSaleSection from './sections/FinalSaleSection';
import BackfillBanner from './BackfillBanner';

interface Props {
  leadId: string;
  leadAddress: string;
  leadStatus?: string;
}

// Section visibility per the approved plan:
// - C Costs:      UNDER_CONTRACT, CLOSING, ACQUIRED, SOLD, SOLD_LOSS, HELD_LONG_TERM
// - D Final Sale: ACQUIRED, SOLD, SOLD_LOSS, HELD_LONG_TERM, CANCELLED
const COSTS_VISIBLE = new Set([
  'UNDER_CONTRACT', 'CLOSING', 'ACQUIRED', 'SOLD', 'SOLD_LOSS', 'HELD_LONG_TERM',
]);
const FINAL_SALE_VISIBLE = new Set([
  'ACQUIRED', 'SOLD', 'SOLD_LOSS', 'HELD_LONG_TERM', 'CANCELLED',
]);

export default function DispoTabV2({ leadId, leadStatus }: Props) {
  const [summary, setSummary] = useState<DispoSummaryV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { data } = await dispoAPI.getSummary(leadId);
      setSummary(data);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Failed to load disposition summary');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !summary) {
    return <div className="p-8 text-sm text-gray-500 animate-pulse">Loading disposition…</div>;
  }
  if (err) {
    return <div className="p-4 text-sm text-red-600 dark:text-red-400">{err}</div>;
  }
  if (!summary) return null;

  const status = leadStatus ?? '';
  const showCosts = COSTS_VISIBLE.has(status);
  const showFinalSale = FINAL_SALE_VISIBLE.has(status);

  return (
    <div className="px-4">
      <ProfitSummarySticky summary={summary} />
      {summary.needsBackfillBanner && <BackfillBanner />}
      <AcquisitionSection leadId={leadId} summary={summary} onChanged={load} />
      <DispositionPlanSection leadId={leadId} summary={summary} onChanged={load} />
      {showCosts && <CostsSection leadId={leadId} summary={summary} onChanged={load} />}
      {showFinalSale && <FinalSaleSection leadId={leadId} summary={summary} onChanged={load} />}
    </div>
  );
}
