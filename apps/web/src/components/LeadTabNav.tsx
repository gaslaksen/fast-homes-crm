'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const TABS = [
  { key: 'overview',       label: 'Overview',        page: 'detail' },
  { key: 'comps',          label: 'Comps',           page: 'comps-analysis' },
  { key: 'arv',            label: 'ARV',             page: 'comps-analysis' },
  { key: 'repairs',        label: 'Repairs',         page: 'comps-analysis' },
  { key: 'deal-analysis',  label: 'Deal Analysis',   page: 'comps-analysis' },
  { key: 'disposition',    label: 'Disposition',     page: 'detail' },
  { key: 'communications', label: 'Communications',  page: 'detail' },
  { key: 'activity',       label: 'Activity',        page: 'detail' },
] as const;

export type LeadTab = (typeof TABS)[number]['key'];

export const DETAIL_TABS: LeadTab[] = ['overview', 'disposition', 'communications', 'activity'];
export const COMPS_TABS: LeadTab[] = ['comps', 'arv', 'repairs', 'deal-analysis'];

interface LeadTabNavProps {
  leadId: string;
  activeTab: string;
}

export default function LeadTabNav({ leadId, activeTab }: LeadTabNavProps) {
  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-4 text-sm overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const href =
              tab.page === 'detail'
                ? `/leads/${leadId}?tab=${tab.key}`
                : `/leads/${leadId}/comps-analysis?tab=${tab.key}`;

            const isActive = activeTab === tab.key;

            return (
              <Link
                key={tab.key}
                href={href}
                className={`py-3 px-1 border-b-2 font-medium whitespace-nowrap ${
                  isActive
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
