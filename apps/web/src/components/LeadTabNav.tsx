'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const TABS = [
  // Conversations leads: the workspace is conversation-first. The key stays
  // 'communications' so existing deep links and ?tab= URLs keep working.
  { key: 'communications', label: 'Conversations',   page: 'detail' },
  { key: 'overview',       label: 'Overview',        page: 'detail' },
  { key: 'valuation',      label: 'Valuation',       page: 'comps-analysis' },
  { key: 'deal-math',      label: 'Deal Math',       page: 'comps-analysis' },
  { key: 'deal-intel',     label: 'Deal Intel',      page: 'comps-analysis' },
  { key: 'disposition',    label: 'Disposition',     page: 'detail' },
  { key: 'activity',       label: 'Activity',        page: 'detail' },
] as const;

export type LeadTab = (typeof TABS)[number]['key'];

export const DETAIL_TABS: LeadTab[] = ['overview', 'disposition', 'communications', 'activity'];
export const COMPS_TABS: LeadTab[] = ['valuation', 'deal-math', 'deal-intel'];

interface LeadTabNavProps {
  leadId: string;
  activeTab: string;
}

export default function LeadTabNav({ leadId, activeTab }: LeadTabNavProps) {
  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <div className="px-4 sm:px-6 lg:px-8">
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
                    : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400'
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
