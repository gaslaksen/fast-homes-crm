'use client';

// Deals Kanban: read-only board over the nine deal stages.
// Reuses BoardScrollShell from kanbanV2 for the fixed-viewport horizontal
// scroll. Drag-drop is intentionally NOT wired — stage transitions for
// late-stage deals have side effects (FinalSale records, JV payouts) that
// belong to the Disposition tab.

import { useMemo, useState } from 'react';
import BoardScrollShell from '@/components/kanbanV2/BoardScrollShell';
import {
  DEAL_STAGE_IDS,
  DEAL_STAGE_LABELS,
  TERMINAL_DEAL_STAGES,
  type DealStageId,
} from '@/lib/dealStages';
import DealsKanbanCard from './DealsKanbanCard';
import DealsContextMenu from './DealsContextMenu';
import type { DealRow } from './types';

interface Props {
  deals: DealRow[];
}

export default function DealsKanban({ deals }: Props) {
  // Terminal columns collapsed by default to keep focus on active deals.
  const [collapsed, setCollapsed] = useState<Set<DealStageId>>(
    () => new Set(TERMINAL_DEAL_STAGES),
  );

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    dealId: string;
    status: DealStageId | string;
  } | null>(null);

  const grouped = useMemo(() => {
    const map: Record<string, DealRow[]> = {};
    for (const id of DEAL_STAGE_IDS) map[id] = [];
    for (const d of deals) {
      if (map[d.status]) map[d.status].push(d);
    }
    return map;
  }, [deals]);

  const toggle = (id: DealStageId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <BoardScrollShell>
      {DEAL_STAGE_IDS.map((id) => {
        const isCollapsed = collapsed.has(id);
        const cards = grouped[id] ?? [];
        return (
          <Column
            key={id}
            id={id}
            label={DEAL_STAGE_LABELS[id]}
            count={cards.length}
            collapsed={isCollapsed}
            onToggle={() => toggle(id)}
            cards={cards}
            onCardContextMenu={(e, dealId, status) =>
              setMenu({ x: e.clientX, y: e.clientY, dealId, status })
            }
          />
        );
      })}
      {menu ? (
        <DealsContextMenu
          x={menu.x}
          y={menu.y}
          dealId={menu.dealId}
          status={menu.status}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </BoardScrollShell>
  );
}

interface ColumnProps {
  id: DealStageId;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  cards: DealRow[];
  onCardContextMenu: (
    e: React.MouseEvent,
    dealId: string,
    status: DealStageId | string,
  ) => void;
}

function Column({
  label,
  count,
  collapsed,
  onToggle,
  cards,
  onCardContextMenu,
}: ColumnProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-11 shrink-0 cursor-pointer flex-col items-center justify-between border-r border-gray-200 bg-gray-50 py-3 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
        title={`Expand ${label}`}
      >
        <span
          className="text-xs font-semibold text-gray-700 dark:text-gray-300"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {label}
        </span>
        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {count}
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/60">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <button
          type="button"
          onClick={onToggle}
          className="text-sm font-semibold text-gray-800 hover:text-primary-600 dark:text-gray-200 dark:hover:text-primary-400"
          title={`Collapse ${label}`}
        >
          {label}
        </button>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {count}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {cards.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
            No deals
          </div>
        ) : (
          cards.map((d) => (
            <DealsKanbanCard key={d.id} deal={d} onContextMenu={onCardContextMenu} />
          ))
        )}
      </div>
    </div>
  );
}
