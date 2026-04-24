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

// Stage label + pill colors — mirrors LeadHeader so pills are consistent everywhere.
const STAGE_META: Record<string, { label: string; cls: string }> = {
  NEW:                { label: 'New',             cls: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  ATTEMPTING_CONTACT: { label: 'Attempting',      cls: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  QUALIFYING:         { label: 'Qualifying',      cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  QUALIFIED:          { label: 'Qualified',       cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  OFFER_SENT:         { label: 'Offer Sent',      cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800' },
  NEGOTIATING:        { label: 'Negotiating',     cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
  UNDER_CONTRACT:     { label: 'Under Contract',  cls: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800' },
  CLOSING:            { label: 'Closing',         cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' },
  CLOSED_WON:         { label: 'Closed Won',      cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' },
  CLOSED_LOST:        { label: 'Closed Lost',     cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700' },
  NURTURE:            { label: 'Nurture',         cls: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800' },
  DEAD:               { label: 'Dead',            cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700' },
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
  const stageMeta = STAGE_META[lead.status] || { label: lead.status, cls: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700' };
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
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${stageMeta.cls}`}>
              {stageMeta.label}
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
