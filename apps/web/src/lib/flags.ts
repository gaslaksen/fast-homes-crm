export const isKanbanV2 = (): boolean =>
  process.env.NEXT_PUBLIC_KANBAN_V2 === 'true';

export const isListViewV2 = (): boolean =>
  process.env.NEXT_PUBLIC_LIST_VIEW_V2 === 'true';

export const isDispositionV2 = (): boolean =>
  process.env.NEXT_PUBLIC_DISPOSITION_V2 === 'true';

export const isDealsView = (): boolean =>
  process.env.NEXT_PUBLIC_DEALS_VIEW === 'true';

export const isAiCompCurationEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_AI_COMP_CURATION === 'true';

export const isCompDrillInEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_COMP_DRILL_IN === 'true';
