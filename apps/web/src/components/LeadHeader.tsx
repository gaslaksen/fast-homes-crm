'use client';

import React from 'react';
import Link from 'next/link';
import PropertyPhoto from '@/components/PropertyPhoto';
import Avatar from '@/components/Avatar';

type Props = {
  lead: any;
  leadId: string;
  aiAnalysis: any | null;
  leadEnrollments?: any[];
  onStatusChange: (newStatus: string) => Promise<void> | void;
};

export default function LeadHeader({
  lead,
  leadId,
  aiAnalysis,
  leadEnrollments = [],
  onStatusChange,
}: Props) {
  const scoreBandLabel =
    ({ STRIKE_ZONE: 'Strike Zone', HOT: 'Hot', WORKABLE: 'Workable', DEAD_COLD: 'Cold' } as Record<string, string>)[
      lead.scoreBand ?? 'DEAD_COLD'
    ] ?? (lead.scoreBand ?? 'Cold').replace('_', ' ');
  const scoreBandColor =
    lead.scoreBand === 'HOT' ? '#ef4444' : lead.scoreBand === 'WARM' ? '#f97316' : '#6b7280';
  const addressQuery = encodeURIComponent(
    [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(', ')
  );

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <PropertyPhoto
              src={lead.primaryPhoto}
              scoreBand={lead.scoreBand}
              address={lead.propertyAddress}
              size="md"
            />
            <div>
              <div className="flex items-center gap-1.5 mb-1 text-xs text-gray-400 dark:text-gray-500">
                <Link href="/leads" className="hover:text-gray-700 dark:hover:text-gray-100 transition-colors">Leads</Link>
                <span>/</span>
                <span className="text-gray-600 dark:text-gray-400 font-medium">{lead.propertyAddress}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{lead.propertyAddress}</h1>
                {lead.tier === 1 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border border-green-300 dark:border-green-800 text-xs font-bold">T1 · Contract Now</span>}
                {lead.tier === 2 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-800 text-xs font-bold">T2 · Opportunity</span>}
                {lead.tier === 3 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 text-xs font-bold">T3 · Dead</span>}
                {lead.status === 'DEAD' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-semibold">
                    💀 Dead
                  </span>
                )}
                {leadEnrollments.some((e: any) => e.status === 'ACTIVE') && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs font-semibold">
                    In Campaign
                  </span>
                )}
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <select
                  value={lead.status}
                  onChange={(e) => onStatusChange(e.target.value)}
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border-0 cursor-pointer appearance-none focus:ring-2 focus:ring-offset-1 ${
                    lead.status === 'CLOSED_WON'                               ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 focus:ring-green-400' :
                    lead.status === 'DEAD' || lead.status === 'CLOSED_LOST'    ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 focus:ring-gray-400' :
                    lead.status === 'UNDER_CONTRACT'                           ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 focus:ring-teal-400' :
                    lead.status === 'OFFER_SENT'                               ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 focus:ring-orange-400' :
                    lead.status === 'NEGOTIATING'                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 focus:ring-amber-400' :
                    lead.status === 'QUALIFYING' || lead.status === 'QUALIFIED'? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 focus:ring-purple-400' :
                    lead.status === 'CLOSING'                                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 focus:ring-emerald-400' :
                    lead.status === 'NURTURE'                                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 focus:ring-sky-400' :
                    'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 focus:ring-blue-400'
                  }`}
                  title="Click to change stage"
                >
                  <option value="NEW">New Lead</option>
                  <option value="ATTEMPTING_CONTACT">Attempting Contact</option>
                  <option value="QUALIFYING">Qualifying</option>
                  <option value="QUALIFIED">Qualified</option>
                  <option value="OFFER_SENT">Offer Made</option>
                  <option value="NEGOTIATING">Negotiating</option>
                  <option value="UNDER_CONTRACT">Under Contract</option>
                  <option value="CLOSING">Closing</option>
                  <option value="CLOSED_WON">Closed / Won</option>
                  <option value="CLOSED_LOST">Closed / Lost</option>
                  <option value="NURTURE">Nurture</option>
                  <option value="DEAD">Dead</option>
                </select>
                {lead.assignedTo && (
                  <div className="flex items-center gap-1.5">
                    <Avatar
                      name={`${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}
                      avatarUrl={lead.assignedTo.avatarUrl}
                      size="sm"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400">{lead.assignedTo.firstName} {lead.assignedTo.lastName}</span>
                  </div>
                )}
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400" title="Total outbound touches (SMS, email & calls)">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="font-semibold">{lead.touchCount ?? 0}</span> touches
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <DonutStat
              value={lead.totalScore ?? 0}
              max={12}
              label={scoreBandLabel}
              color={scoreBandColor}
              size={60}
            />
            {aiAnalysis?.dealRating != null ? (
              <DonutStat
                value={aiAnalysis.dealRating}
                max={10}
                label="AI Score"
                color={aiAnalysis.dealRating >= 7 ? '#10b981' : aiAnalysis.dealRating >= 4 ? '#f59e0b' : '#ef4444'}
                size={60}
              />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <a
                href={`https://www.zillow.com/homes/${addressQuery}_rb/`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Zillow"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-[#006AFF] hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors text-xs font-semibold text-[#006AFF]"
              >
                <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z" fill="#006AFF"/>
                  <path d="M22.4 21.6H9.6v-1.92l8.064-8.064H9.6V9.6h12.8v1.92l-8.064 8.064H22.4v2.016z" fill="white"/>
                </svg>
                Zillow
              </a>
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(
                  `site:realtor.com ${[lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(', ')}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Realtor.com"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-[#D92228] hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-xs font-semibold text-[#D92228]"
              >
                <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z" fill="#D92228"/>
                  <path d="M12.8 9.6h4.8c1.6 0 2.88.48 3.68 1.28.64.64.96 1.52.96 2.56 0 1.76-1.04 2.88-2.56 3.36l2.88 4.8h-2.72l-2.56-4.32H15.2v4.32h-2.4V9.6zm4.64 5.76c1.28 0 2.08-.64 2.08-1.76s-.8-1.76-2.08-1.76H15.2v3.52h2.24z" fill="white"/>
                </svg>
                Realtor.com
              </a>
            </div>
            <Link href={`/leads/${leadId}/edit`} className="btn btn-primary">
              Edit Lead
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

function DonutStat({
  value, max, label, color, size = 56,
}: { value: number; max: number; label: string; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(value / max, 1) * circ;
  const cx = size / 2;
  const textStyle = {
    transform: `rotate(90deg)`,
    transformOrigin: `${cx}px ${cx}px`,
    fontSize: size < 52 ? 11 : 13,
    fontWeight: 700,
    fill: color,
  } as React.CSSProperties;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central" style={textStyle}>
          {value}
        </text>
      </svg>
      <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight mt-0.5">{label}</div>
    </div>
  );
}
