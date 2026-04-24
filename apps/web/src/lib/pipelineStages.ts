export type PipelineStageId =
  | 'NEW'
  | 'ATTEMPTING_CONTACT'
  | 'QUALIFYING'
  | 'QUALIFIED'
  | 'OFFER_SENT'
  | 'NEGOTIATING'
  | 'UNDER_CONTRACT'
  | 'CLOSING'
  | 'NURTURE';

export interface PipelineStage {
  id: PipelineStageId;
  name: string;
  color: string;
  accent: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: 'NEW',
    name: 'New Leads',
    color:
      'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-800 text-primary-800 dark:text-primary-400',
    accent: 'bg-primary-500',
  },
  {
    id: 'ATTEMPTING_CONTACT',
    name: 'Attempting Contact',
    color:
      'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400',
    accent: 'bg-yellow-500',
  },
  {
    id: 'QUALIFYING',
    name: 'Qualifying',
    color:
      'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-400',
    accent: 'bg-purple-500',
  },
  {
    id: 'QUALIFIED',
    name: 'Qualified',
    color:
      'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-800 text-violet-800 dark:text-violet-400',
    accent: 'bg-violet-500',
  },
  {
    id: 'OFFER_SENT',
    name: 'Offer Made',
    color:
      'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-800 text-orange-800 dark:text-orange-400',
    accent: 'bg-orange-500',
  },
  {
    id: 'NEGOTIATING',
    name: 'Negotiating',
    color:
      'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-400',
    accent: 'bg-amber-500',
  },
  {
    id: 'UNDER_CONTRACT',
    name: 'Under Contract',
    color:
      'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-400',
    accent: 'bg-teal-500',
  },
  {
    id: 'CLOSING',
    name: 'Closing',
    color:
      'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400',
    accent: 'bg-emerald-500',
  },
  {
    id: 'NURTURE',
    name: 'Nurture',
    color:
      'bg-sky-100 dark:bg-sky-900/30 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400',
    accent: 'bg-sky-500',
  },
];

export const EARLY_STAGES: PipelineStageId[] = ['NEW', 'ATTEMPTING_CONTACT'];

export const getStage = (id: string): PipelineStage | undefined =>
  PIPELINE_STAGES.find((s) => s.id === id);
