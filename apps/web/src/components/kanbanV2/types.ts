import type { PipelineStageId } from '@/lib/pipelineStages';

export type Density = 'comfortable' | 'compact' | 'ultra';

export type ColumnSortKey =
  | 'lastTouchOldest'
  | 'mostTouches'
  | 'fewestTouches'
  | 'alphabetical'
  | 'newest'
  | 'tierScore';

export interface DripEnrollment {
  id: string;
  campaignId: string;
  currentStepOrder: number;
  nextSendAt: string | null;
  campaign: { id: string; name: string };
}

export interface DripSequenceLite {
  id: string;
  status: string;
  currentStep: number;
  lastMessageAt: string | null;
}

export interface StageChangeActivity {
  id: string;
  metadata: {
    oldStatus?: string;
    newStatus?: string;
    reason?: string;
    bulk?: boolean;
  } | null;
  createdAt: string;
  userId: string | null;
  user: { firstName: string | null; lastName: string | null } | null;
}

export interface KanbanLead {
  id: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string | null;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  sellerPhone: string | null;
  status: string;
  totalScore: number;
  scoreBand: string;
  tier: number | null;
  arv: number | null;
  askingPrice: number | null;
  primaryPhoto: string | null;
  lastTouchedAt: string;
  touchCount: number;
  daysInStage: number;
  stageChangedAt: string;
  aiRecommendation: string | null;
  assignedToUserId: string | null;
  assignedTo: { id: string; firstName: string | null; lastName: string | null } | null;
  assignedStage: string | null;
  createdAt: string;
  dripSequence: DripSequenceLite | null;
  campaignEnrollments: DripEnrollment[];
  activities: StageChangeActivity[];
}

export type LeadsByStage = Record<PipelineStageId | string, KanbanLead[]>;
