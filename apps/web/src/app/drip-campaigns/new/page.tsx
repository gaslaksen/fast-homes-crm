'use client';

import AppNav from '@/components/AppNav';
import CampaignBuilder from '@/components/drip/CampaignBuilder';
import Link from 'next/link';

export default function NewCampaignPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <Link
            href="/drip-campaigns"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            ← Back to Campaigns
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-2">New Campaign</h1>
        </div>
        <CampaignBuilder />
      </div>
    </div>
  );
}
