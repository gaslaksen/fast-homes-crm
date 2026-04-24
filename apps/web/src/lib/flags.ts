export const isKanbanV2 = (): boolean =>
  process.env.NEXT_PUBLIC_KANBAN_V2 === 'true';

export const isListViewV2 = (): boolean =>
  process.env.NEXT_PUBLIC_LIST_VIEW_V2 === 'true';
