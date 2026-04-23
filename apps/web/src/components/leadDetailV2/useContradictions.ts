'use client';

import { useEffect, useState, useCallback } from 'react';
import { leadsAPI } from '@/lib/api';

export interface Contradiction {
  id: string;
  severity: 'warning' | 'error';
  message: string;
  actions: { label: string; onClick: () => void }[];
  fingerprint: string;
}

function computeFingerprint(lead: any, ruleId: string): string {
  // Rule-specific fingerprints so dismissals re-trigger when relevant state changes
  switch (ruleId) {
    case 'dead-with-drip': return `${lead.tier}|${lead.dripSequence?.id ?? 'none'}|${lead.dripSequence?.status ?? 'none'}`;
    case 'dead-with-auto-respond': return `${lead.tier}|${lead.autoRespond ? 1 : 0}`;
    case 'qualified-no-arv': return `${lead.status}|${lead.arv ?? 'none'}`;
    case 'contract-no-record': return `${lead.status}|${lead.contract?.id ?? 'none'}`;
    case 'won-no-offers': return `${lead.status}|${lead.offers?.length ?? 0}`;
    case 'camp-complete-dead': return `${lead.tier}|${lead.campPriorityComplete}${lead.campMoneyComplete}${lead.campChallengeComplete}${lead.campAuthorityComplete}`;
    default: return '';
  }
}

interface Args {
  lead: any;
  leadId: string;
  onPauseDrip: () => void;
  onTurnOffAutoRespond: () => void;
  onRunAnalysis: () => void;
  onOpenContract: () => void;
  onReviewTier: () => void;
}

export function useContradictions({ lead, leadId, onPauseDrip, onTurnOffAutoRespond, onRunAnalysis, onOpenContract, onReviewTier }: Args) {
  const [dismissals, setDismissals] = useState<Record<string, { fingerprint: string; dismissedAt: string }>>({});

  useEffect(() => {
    leadsAPI.getAlertDismissals(leadId).then((res) => {
      setDismissals(res.data || {});
    }).catch(() => setDismissals({}));
  }, [leadId]);

  const dismiss = useCallback(async (ruleId: string, fingerprint: string) => {
    try {
      const res = await leadsAPI.dismissAlert(leadId, ruleId, fingerprint);
      setDismissals(res.data || {});
    } catch (err) {
      console.error('Failed to dismiss alert', err);
    }
  }, [leadId]);

  const allRules: Contradiction[] = [];

  const dripActive = lead.dripSequence && lead.dripSequence.status === 'ACTIVE';
  if (lead.tier === 3 && dripActive) {
    allRules.push({
      id: 'dead-with-drip',
      severity: 'warning',
      message: 'This lead is marked Dead but enrolled in an active drip.',
      actions: [{ label: 'Pause drip', onClick: onPauseDrip }],
      fingerprint: computeFingerprint(lead, 'dead-with-drip'),
    });
  }
  if (lead.tier === 3 && lead.autoRespond) {
    allRules.push({
      id: 'dead-with-auto-respond',
      severity: 'warning',
      message: 'Auto-Respond is on for a Dead lead.',
      actions: [{ label: 'Turn off', onClick: onTurnOffAutoRespond }],
      fingerprint: computeFingerprint(lead, 'dead-with-auto-respond'),
    });
  }
  if (lead.status === 'QUALIFIED' && !lead.arv) {
    allRules.push({
      id: 'qualified-no-arv',
      severity: 'warning',
      message: 'Qualified stage usually requires ARV.',
      actions: [{ label: 'Run analysis', onClick: onRunAnalysis }],
      fingerprint: computeFingerprint(lead, 'qualified-no-arv'),
    });
  }
  if (lead.status === 'UNDER_CONTRACT' && !lead.contract) {
    allRules.push({
      id: 'contract-no-record',
      severity: 'error',
      message: 'Under Contract stage but no contract record found.',
      actions: [{ label: 'Open contract', onClick: onOpenContract }],
      fingerprint: computeFingerprint(lead, 'contract-no-record'),
    });
  }
  if (lead.status === 'CLOSED_WON' && (!lead.offers || lead.offers.length === 0)) {
    allRules.push({
      id: 'won-no-offers',
      severity: 'warning',
      message: 'Closed Won without offer history.',
      actions: [],
      fingerprint: computeFingerprint(lead, 'won-no-offers'),
    });
  }
  const campComplete = lead.campPriorityComplete && lead.campMoneyComplete && lead.campChallengeComplete && lead.campAuthorityComplete;
  if (campComplete && lead.tier === 3) {
    allRules.push({
      id: 'camp-complete-dead',
      severity: 'warning',
      message: 'CAMP data gathered but marked dead — consider reviewing tier.',
      actions: [{ label: 'Review tier', onClick: onReviewTier }],
      fingerprint: computeFingerprint(lead, 'camp-complete-dead'),
    });
  }

  const active = allRules.filter((rule) => {
    const d = dismissals[rule.id];
    return !d || d.fingerprint !== rule.fingerprint;
  });

  return { contradictions: active, dismiss };
}
