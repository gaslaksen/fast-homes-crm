'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppNav from '@/components/AppNav';
import CampaignBuilder from '@/components/drip/CampaignBuilder';
import { campaignAPI } from '@/lib/api';

export default function EditCampaignPage() {
  const params = useParams();
  const id = params.id as string;
  const [campaign, setCampaign] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    campaignAPI
      .get(id)
      .then((res) => setCampaign(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <Link
            href="/drip-campaigns"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            ← Back to Campaigns
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-2">
            Edit Campaign
          </h1>
        </div>
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading...</div>
        ) : campaign ? (
          <CampaignBuilder
            initial={{
              id: campaign.id,
              name: campaign.name,
              description: campaign.description || '',
              triggerDays: campaign.triggerDays,
              isActive: campaign.isActive,
              steps: (campaign.steps || []).map((s: any) => ({
                id: s.id,
                stepOrder: s.stepOrder,
                channel: s.channel,
                delayDays: s.delayDays,
                delayHours: s.delayHours,
                sendWindowStart: s.sendWindowStart || '09:00',
                sendWindowEnd: s.sendWindowEnd || '18:00',
                subject: s.subject || '',
                body: s.body || '',
                isActive: s.isActive,
              })),
            }}
          />
        ) : (
          <div className="text-center py-16 text-gray-400">Campaign not found.</div>
        )}
      </div>
    </div>
  );
}
