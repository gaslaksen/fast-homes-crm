import type { ColumnSortKey, KanbanLead } from './types';

export function sortLeads(leads: KanbanLead[], key: ColumnSortKey): KanbanLead[] {
  const copy = [...leads];
  switch (key) {
    case 'lastTouchOldest':
      return copy.sort(
        (a, b) =>
          new Date(a.lastTouchedAt).getTime() - new Date(b.lastTouchedAt).getTime(),
      );
    case 'mostTouches':
      return copy.sort((a, b) => b.touchCount - a.touchCount);
    case 'fewestTouches':
      return copy.sort((a, b) => a.touchCount - b.touchCount);
    case 'alphabetical':
      return copy.sort((a, b) =>
        a.propertyAddress.localeCompare(b.propertyAddress),
      );
    case 'newest':
      return copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case 'tierScore':
    default:
      return copy.sort((a, b) => {
        const tierA = a.tier ?? 99;
        const tierB = b.tier ?? 99;
        if (tierA !== tierB) return tierA - tierB;
        if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
        return new Date(b.lastTouchedAt).getTime() - new Date(a.lastTouchedAt).getTime();
      });
  }
}
