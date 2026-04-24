'use client';

import Link from 'next/link';
import PropertyPhoto from '@/components/PropertyPhoto';
import Avatar from '@/components/Avatar';
import DripEnvelopeIcon from '@/components/icons/DripEnvelopeIcon';
import { computeMao, computeSpread, formatK } from '@/lib/dealMath';
import StagePill from './StagePill';
import EmptyCellChip from './EmptyCellChip';
import TouchBadge from './TouchBadge';

const INACTIVE_STATUSES = ['DEAD', 'CLOSED_WON', 'CLOSED_LOST'];
const SOURCE_LABELS: Record<string, string> = {
  PROPERTY_LEADS: 'PPL',
  GOOGLE_ADS: 'PPC',
  MANUAL: 'Manual',
  DEAL_SEARCH: 'Deal Search',
  OTHER: 'Other',
};

export interface ListLead {
  id: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  source: string | null;
  status: string;
  totalScore: number;
  scoreBand: string;
  tier: number | null;
  arv: number | null;
  askingPrice: number | null;
  primaryPhoto: string | null;
  lastTouchedAt: string | null;
  touchCount: number;
  assignedTo: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    avatarUrl?: string | null;
  } | null;
  dripSequence?: { status: string } | null;
  campaignEnrollments?: { id: string; status: string }[];
}

interface Props {
  lead: ListLead;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRenderTier: (lead: ListLead) => React.ReactNode;
  onRenderScore: (lead: ListLead) => React.ReactNode;
}

function lastTouchCell(lastTouchedAt: string | null, status: string) {
  if (!lastTouchedAt) {
    return <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>;
  }
  const hoursAgo = Math.round((Date.now() - new Date(lastTouchedAt).getTime()) / 3_600_000);
  const isActive = !INACTIVE_STATUSES.includes(status);
  const stale = isActive && hoursAgo > 24 * 5; // matches Kanban v2 STALE_MS (5 days)
  return (
    <span
      className={`text-[11px] ${
        stale ? 'text-amber-600 font-semibold' : 'text-gray-400 dark:text-gray-500'
      }`}
      title={stale ? 'No outbound contact in 5+ days' : undefined}
    >
      {hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`}
      {stale ? ' ⚠' : ''}
    </span>
  );
}

function spreadColor(n: number): string {
  return n > 0
    ? 'text-emerald-700 dark:text-emerald-400'
    : n < 0
    ? 'text-red-700 dark:text-red-400'
    : 'text-gray-500';
}

export default function LeadRow({
  lead,
  selected,
  onToggleSelect,
  onRenderTier,
  onRenderScore,
}: Props) {
  const mao = computeMao(lead.arv);
  const spread = computeSpread(lead.arv, lead.askingPrice);
  const isDead = lead.status === 'DEAD';
  const isInDrip =
    lead.dripSequence?.status === 'ACTIVE' ||
    (lead.campaignEnrollments?.some((e) => e.status === 'ACTIVE') ?? false);

  return (
    <div
      className={`grid grid-cols-[auto_44px_2fr_130px_68px_72px_72px_72px_72px_72px_60px_72px] gap-3 items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group ${
        selected ? 'bg-primary-50/40 dark:bg-primary-950/40' : ''
      } ${isDead ? 'opacity-60' : ''}`}
    >
      {/* select */}
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(lead.id)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
      />

      {/* photo */}
      <PropertyPhoto
        src={lead.primaryPhoto}
        scoreBand={lead.scoreBand}
        address={lead.propertyAddress}
        size="sm"
      />

      {/* property / seller */}
      <Link href={`/leads/${lead.id}`} className="min-w-0">
        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate group-hover:text-primary-700 dark:group-hover:text-primary-400">
          {lead.propertyAddress}
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {lead.propertyCity}, {lead.propertyState} · {lead.sellerFirstName}{' '}
          {lead.sellerLastName}
          {lead.source && (
            <span className="ml-1 text-gray-300 dark:text-gray-600">
              · {SOURCE_LABELS[lead.source] || lead.source}
            </span>
          )}
        </div>
      </Link>

      {/* stage + drip indicator + assignee */}
      <Link href={`/leads/${lead.id}`} className="flex items-center gap-1.5 min-w-0">
        <StagePill status={lead.status} />
        {isInDrip && (
          <span
            title="Enrolled in active drip campaign"
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 shrink-0"
          >
            <DripEnvelopeIcon className="w-2.5 h-2.5" />
          </span>
        )}
        {lead.assignedTo && (
          <Avatar
            name={`${lead.assignedTo.firstName ?? ''} ${lead.assignedTo.lastName ?? ''}`}
            avatarUrl={lead.assignedTo.avatarUrl ?? undefined}
            size="sm"
          />
        )}
      </Link>

      {/* tier */}
      <Link href={`/leads/${lead.id}`} className="flex justify-center">
        {onRenderTier(lead)}
      </Link>

      {/* score (DEPRECATED: Score system being phased out; see docs/build-prompts/README.md 006) */}
      <Link href={`/leads/${lead.id}`} className="flex justify-center">
        {onRenderScore(lead)}
      </Link>

      {/* ARV */}
      <div className="text-right">
        <EmptyCellChip
          value={lead.arv}
          formatted={formatK(lead.arv)}
          cta="+ ARV"
          href={`/leads/${lead.id}/comps-analysis?tab=arv`}
        />
      </div>

      {/* MAO */}
      <div className="text-right">
        <EmptyCellChip
          value={mao}
          formatted={formatK(mao)}
          cta="+ MAO"
          href={`/leads/${lead.id}/comps-analysis?tab=deal-analysis`}
          colorClass="text-gray-700 dark:text-gray-300"
          title={
            mao == null
              ? 'MAO requires ARV'
              : `MAO = ARV × 0.7 − $55k repairs allowance`
          }
        />
      </div>

      {/* Asking */}
      <div className="text-right">
        <EmptyCellChip
          value={lead.askingPrice}
          formatted={formatK(lead.askingPrice)}
          cta="+ Ask"
          href={`/leads/${lead.id}/edit#asking`}
          colorClass="text-gray-600 dark:text-gray-400"
        />
      </div>

      {/* Spread */}
      <div className="text-right">
        {spread != null ? (
          <span className={`text-xs font-bold ${spreadColor(spread)}`}>
            {spread >= 0 ? '+' : ''}
            {formatK(spread)}
          </span>
        ) : (
          <span
            title="Spread requires MAO and Asking Price."
            className="text-xs text-gray-300 dark:text-gray-600"
          >
            —
          </span>
        )}
      </div>

      {/* Touches */}
      <Link href={`/leads/${lead.id}`} className="flex justify-center">
        <TouchBadge count={lead.touchCount ?? 0} />
      </Link>

      {/* Last Touch */}
      <Link href={`/leads/${lead.id}`} className="block text-right">
        {lastTouchCell(lead.lastTouchedAt, lead.status)}
      </Link>
    </div>
  );
}

export const LIST_GRID_COLS_CLASS =
  'grid-cols-[auto_44px_2fr_130px_68px_72px_72px_72px_72px_72px_60px_72px]';
