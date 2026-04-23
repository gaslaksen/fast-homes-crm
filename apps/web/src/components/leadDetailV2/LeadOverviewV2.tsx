'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import HeroStrip from './HeroStrip';
import ActionBar from './ActionBar';
import SellerPropertyCard from './SellerPropertyCard';
import CampDiscoveryCard from './CampDiscoveryCard';
import PhotosCard from './PhotosCard';
import PipelineTierCard from './PipelineTierCard';
import AlertsCard from './AlertsCard';
import { useContradictions } from './useContradictions';
import { getPrimaryAction } from './actionMap';
import SellerPortalPanel from '@/components/SellerPortalPanel';
import { leadsAPI } from '@/lib/api';

export interface LeadOverviewV2Props {
  lead: any;
  leadId: string;
  currentUser: any;
  teamMembers: any[];
  leadTasks: any[];
  setLead: (updater: any) => void;
  reload: () => void;
  handlers: {
    onToggleAutoRespond: () => void;
    onAssign: () => void;
    onUnassign: () => void;
    onSetTier: (tier: number | null) => void;
    onFetchComps: (force?: boolean) => void;
    onSendOutreach: () => void;
    onAiCall: () => void;
    onMarkDead: () => void;
    onSaveArv: () => void;
    onUploadPhotos: (files: File[]) => void;
    onFetchPhotos: () => void;
    onDeletePhoto: (id: string) => void;
    onSetPrimaryPhoto: (id: string) => void;
    onCompleteTask: (id: string) => void;
    onOpenFollowUpModal: () => void;
    onOpenShareModal: () => void;
    openCommunications: (action?: string) => void;
    openDisposition: (action?: string) => void;
  };
  uiState: {
    assignUserId: string;
    setAssignUserId: (v: string) => void;
    assignStage: string;
    setAssignStage: (v: string) => void;
    assignSaving: boolean;
    togglingAutoRespond: boolean;
    settingTier: boolean;
    fetchingComps: boolean;
    sendingOutreach: boolean;
    initiatingCall: boolean;
    showArvEdit: boolean;
    setShowArvEdit: (v: boolean) => void;
    arvInput: string;
    setArvInput: (v: string) => void;
    savingArv: boolean;
  };
}

export default function LeadOverviewV2(props: LeadOverviewV2Props) {
  const { lead, leadId, handlers, uiState } = props;
  const searchParams = useSearchParams();
  const router = useRouter();
  const intent = searchParams.get('action');
  const primary = getPrimaryAction(lead, intent);

  const runPrimary = () => {
    switch (primary.intent) {
      case 'reply':
      case 'sms':
        return handlers.openCommunications('reply');
      case 'offer':
        return handlers.openDisposition('offer');
      case 'follow-up':
        return handlers.onOpenFollowUpModal();
      case 'camp':
        return handlers.openCommunications(intent?.startsWith('camp') ? intent : 'camp');
      case 'contract':
        return handlers.openDisposition('contract');
      case 'call':
        window.location.href = `tel:${lead.sellerPhone}`;
        return;
      case 'share':
        return handlers.onOpenShareModal();
    }
  };

  const portalViewCount = (lead?.sellerPortal?.viewCount as number | undefined) ?? 0;

  const [aiInsight, setAiInsight] = useState<string | null>(lead.aiInsight ?? null);
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInsightLoading(true);
    leadsAPI.getAiInsight(leadId).then((res) => {
      if (cancelled) return;
      setAiInsight(res.data?.insight ?? null);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setInsightLoading(false);
    });
    return () => { cancelled = true; };
  }, [leadId, lead.status, lead.tier, lead.campPriorityComplete, lead.campMoneyComplete, lead.campChallengeComplete, lead.campAuthorityComplete, lead.arv, lead.askingPrice]);

  const regenerateInsight = async () => {
    setInsightLoading(true);
    try {
      const res = await leadsAPI.getAiInsight(leadId, true);
      setAiInsight(res.data?.insight ?? null);
    } finally {
      setInsightLoading(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="lead-overview-v2">
      <HeroStrip
        lead={lead}
        leadId={leadId}
        aiInsight={aiInsight}
        insightLoading={insightLoading}
        onGenerateInsight={regenerateInsight}
        onRunAnalysis={() => router.push(`/leads/${leadId}/comps-analysis`)}
        onAskPrice={() => handlers.openCommunications('camp&field=money')}
      />

      <ActionBar
        lead={lead}
        primary={primary}
        onPrimary={runPrimary}
        quickActions={{
          onSms: () => handlers.openCommunications('reply'),
          onCall: () => { window.location.href = `tel:${lead.sellerPhone}`; },
          onAiCall: handlers.onAiCall,
          onFollowUp: handlers.onOpenFollowUpModal,
          onShare: handlers.onOpenShareModal,
          onOffer: () => handlers.openDisposition('offer'),
          onMarkDead: handlers.onMarkDead,
        }}
        status={{
          autoRespond: !!lead.autoRespond,
          onToggleAutoRespond: handlers.onToggleAutoRespond,
          togglingAutoRespond: uiState.togglingAutoRespond,
          portalViewCount,
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SellerPropertyCard
            lead={lead}
            onCall={() => { window.location.href = `tel:${lead.sellerPhone}`; }}
            onText={() => handlers.openCommunications('reply')}
            onEmail={() => handlers.openCommunications('reply')}
          />
          <CampDiscoveryCard
            lead={lead}
            onAskCampField={(field) => handlers.openCommunications(`camp&field=${field}`)}
          />
          <PhotosCard
            lead={lead}
            leadId={leadId}
            onUpload={handlers.onUploadPhotos}
            onFetchPhotos={handlers.onFetchPhotos}
            onDelete={handlers.onDeletePhoto}
            onSetPrimary={handlers.onSetPrimaryPhoto}
          />
        </div>
        <div className="lg:col-span-1 space-y-6">
          <PipelineTierCard
            lead={lead}
            leadId={leadId}
            setLead={props.setLead}
            teamMembers={props.teamMembers}
            assignUserId={uiState.assignUserId}
            setAssignUserId={uiState.setAssignUserId}
            assignStage={uiState.assignStage}
            setAssignStage={uiState.setAssignStage}
            assignSaving={uiState.assignSaving}
            onAssign={handlers.onAssign}
            onUnassign={handlers.onUnassign}
            onSetTier={handlers.onSetTier}
            settingTier={uiState.settingTier}
          />
          <SellerPortalPanel leadId={leadId} />
          <AlertsZone
            lead={lead}
            leadId={leadId}
            handlers={handlers}
            reload={props.reload}
            router={router}
          />
        </div>
      </div>
    </div>
  );
}

function AlertsZone({ lead, leadId, handlers, reload, router }: { lead: any; leadId: string; handlers: any; reload: () => void; router: any }) {
  const { contradictions, dismiss } = useContradictions({
    lead,
    leadId,
    onPauseDrip: async () => {
      try {
        await leadsAPI.cancelDrip(leadId, 'User paused from Alerts');
        reload();
      } catch (err) {
        console.error('Failed to pause drip', err);
      }
    },
    onTurnOffAutoRespond: async () => {
      if (!lead.autoRespond) return;
      await handlers.onToggleAutoRespond();
    },
    onRunAnalysis: () => router.push(`/leads/${leadId}/comps-analysis`),
    onOpenContract: () => handlers.openDisposition('contract'),
    onReviewTier: () => {
      const el = document.getElementById('camp-priority');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    },
  });
  return <AlertsCard contradictions={contradictions} onDismiss={dismiss} />;
}
