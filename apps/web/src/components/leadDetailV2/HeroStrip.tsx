'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export function computeMao(lead: any): number | null {
  if (!lead?.arv) return null;
  const repairEst = lead.repairCosts || 0;
  const fee = lead.assignmentFee || 0;
  const maoPct = (lead.maoPercent ?? 70) / 100;
  return Math.max(0, Math.round(lead.arv * maoPct - fee - repairEst));
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

const TIER_CONFIG: Record<number, { label: string; cls: string }> = {
  1: { label: 'T1 Contract Now', cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-800' },
  2: { label: 'T2 Keep Pursuing', cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-800' },
  3: { label: 'T3 Cold', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-700' },
};

const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  OFFER_MADE: 'Offer Made',
  UNDER_CONTRACT: 'Under Contract',
  CLOSED_WON: 'Closed Won',
  CLOSED_LOST: 'Closed Lost',
  DEAD: 'Dead',
};

interface Props {
  lead: any;
  leadId: string;
  aiInsight?: string | null;
  insightLoading?: boolean;
  onGenerateInsight?: () => void;
  onRunAnalysis: () => void;
  onAskPrice: () => void;
}

export default function HeroStrip({ lead, leadId, aiInsight, insightLoading, onGenerateInsight, onRunAnalysis, onAskPrice }: Props) {
  const mao = computeMao(lead);
  const arv = lead.arv as number | null | undefined;
  const asking = lead.askingPrice as number | null | undefined;
  const spread = arv && asking ? arv - asking : null;
  const tier = lead.tier as number | null;
  const tierCfg = tier ? TIER_CONFIG[tier] : null;
  const stageLabel = STAGE_LABELS[lead.status] || lead.status;
  const lastTouchedAt = lead.lastTouchedAt ? new Date(lead.lastTouchedAt) : null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 lg:p-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* FINANCIAL */}
        <div className="lg:col-span-5 grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">ARV</div>
            {arv ? (
              <>
                <div className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{fmtMoney(arv)}</div>
                {lead.arvConfidence != null && (
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{Math.round(lead.arvConfidence)}% conf.</div>
                )}
              </>
            ) : (
              <>
                <div className="text-xl lg:text-2xl font-bold text-gray-400 dark:text-gray-600 leading-tight">—</div>
                <button onClick={onRunAnalysis} className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline mt-0.5">
                  Run analysis →
                </button>
              </>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500" title={arv ? `${Math.round(((lead.maoPercent ?? 70)))}% × ARV − repairs − fees` : ''}>MAO</div>
            {mao != null ? (
              <>
                <div className="text-xl lg:text-2xl font-bold text-primary-700 dark:text-primary-400 leading-tight">{fmtMoney(mao)}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{Math.round(lead.maoPercent ?? 70)}% rule</div>
              </>
            ) : (
              <>
                <div className="text-xl lg:text-2xl font-bold text-gray-400 dark:text-gray-600 leading-tight">—</div>
                <Link href={`/leads/${leadId}/comps-analysis`} className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline mt-0.5 inline-block">
                  Complete analysis →
                </Link>
              </>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">Spread</div>
            {spread != null && mao != null ? (
              <>
                <div className={`text-xl lg:text-2xl font-bold leading-tight ${
                  (asking ?? 0) <= mao ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {(asking ?? 0) <= mao ? '✓' : ''} {fmtMoney(mao - (asking ?? 0))}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                  MAO − asking {fmtMoney(asking)}
                </div>
              </>
            ) : (
              <>
                <div className="text-xl lg:text-2xl font-bold text-gray-400 dark:text-gray-600 leading-tight">—</div>
                <button onClick={onAskPrice} className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline mt-0.5">
                  {asking ? 'Run analysis →' : 'Ask seller for price →'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* STATUS */}
        <div className="lg:col-span-3 flex flex-col justify-center gap-1.5 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700 pt-3 lg:pt-0 lg:pl-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {tierCfg && (
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${tierCfg.cls}`}>{tierCfg.label}</span>
            )}
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
              {stageLabel}
            </span>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {lastTouchedAt ? (
              <>Last touched {formatDistanceToNow(lastTouchedAt, { addSuffix: true })}</>
            ) : (
              <>No contact yet</>
            )}
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500">
            {lead.touchCount ?? 0} {(lead.touchCount ?? 0) === 1 ? 'touch' : 'touches'}
          </div>
        </div>

        {/* AI INSIGHT */}
        <div className="lg:col-span-4 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700 pt-3 lg:pt-0 lg:pl-5">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
            <span>✨</span> <span>AI Insight</span>
          </div>
          {insightLoading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 italic">Generating…</div>
          ) : aiInsight ? (
            <div className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{aiInsight}</div>
          ) : (
            <button
              onClick={onGenerateInsight}
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              disabled={!onGenerateInsight}
            >
              Generate insight →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
