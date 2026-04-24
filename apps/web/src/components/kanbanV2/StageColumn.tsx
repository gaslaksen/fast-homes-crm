'use client';

import { Draggable, Droppable } from '@hello-pangea/dnd';
import type { MutableRefObject } from 'react';
import type { PipelineStage } from '@/lib/pipelineStages';
import { EARLY_STAGES } from '@/lib/pipelineStages';
import LeadCard from './LeadCard';
import ColumnSortMenu from './ColumnSortMenu';
import { DEFAULT_SORT } from './hooks/useKanbanPrefs';
import { sortLeads } from './sortLeads';
import type { ColumnSortKey, Density, KanbanLead } from './types';

interface Props {
  stage: PipelineStage;
  leads: KanbanLead[];
  density: Density;
  collapsed: boolean;
  onToggleCollapse: () => void;
  sortKey: ColumnSortKey;
  onSortChange: (key: ColumnSortKey) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onSelectAllInColumn: (stageId: string) => void;
  anyCardSelectedInBoard: boolean;
  onContextMenu?: (e: React.MouseEvent, lead: KanbanLead) => void;
  onPauseDrip?: (leadId: string, enrollmentId: string | null) => void | Promise<void>;
  onAddLead?: (stageId: string) => void;
  seenRecentMoveRef: MutableRefObject<Set<string>>;
}

export default function StageColumn({
  stage,
  leads,
  density,
  collapsed,
  onToggleCollapse,
  sortKey,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onSelectAllInColumn,
  anyCardSelectedInBoard,
  onContextMenu,
  onPauseDrip,
  onAddLead,
  seenRecentMoveRef,
}: Props) {
  const sorted = sortLeads(leads, sortKey || DEFAULT_SORT);
  const anyInColSelected = sorted.some((l) => selectedIds.has(l.id));

  if (collapsed) {
    return (
      <div
        className="shrink-0 w-11 h-full border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex flex-col items-center py-2 cursor-pointer select-none"
        onClick={onToggleCollapse}
        title={`${stage.name} — click to expand`}
      >
        <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
          {leads.length}
        </div>
        <div
          className="mt-2 text-[11px] font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap"
          style={{ writingMode: 'vertical-rl' }}
        >
          {stage.name}
        </div>
      </div>
    );
  }

  const columnWidth =
    density === 'ultra' ? 280 : density === 'compact' ? 260 : 260;

  return (
    <div
      className="shrink-0 flex flex-col h-full border-r border-gray-200 dark:border-gray-700"
      style={{ width: columnWidth, scrollSnapAlign: 'start' }}
    >
      {/* Header */}
      <div className={`shrink-0 px-2.5 py-2 border-b ${stage.color} flex items-center gap-2`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-xs opacity-70 hover:opacity-100"
          aria-label="Collapse column"
          title="Collapse"
        >
          ◂
        </button>
        <div className="flex-1 min-w-0 font-semibold text-xs uppercase tracking-wide truncate">
          {stage.name}
        </div>
        <span className="text-[11px] opacity-80 font-semibold">
          {leads.length}
        </span>
        {anyCardSelectedInBoard && !anyInColSelected && leads.length > 0 && (
          <button
            type="button"
            onClick={() => onSelectAllInColumn(stage.id)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/30 hover:bg-white dark:hover:bg-black/50"
            title="Select all in column"
          >
            All
          </button>
        )}
        <ColumnSortMenu value={sortKey} onChange={onSortChange} />
      </div>

      {/* Droppable body (scrolls vertically) */}
      <Droppable droppableId={stage.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 overflow-y-auto px-2 py-2 space-y-1.5 ${
              snapshot.isDraggingOver ? 'bg-primary-50/40 dark:bg-primary-900/10' : ''
            }`}
          >
            {sorted.length === 0 ? (
              <div className="text-center text-[11px] text-gray-400 py-6">
                No leads in {stage.name}
                {EARLY_STAGES.includes(stage.id) && onAddLead && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onAddLead(stage.id)}
                      className="text-[11px] px-2 py-1 rounded border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 text-gray-600 dark:text-gray-300"
                    >
                      + Add Lead
                    </button>
                  </div>
                )}
              </div>
            ) : (
              sorted.map((lead, idx) => (
                <Draggable draggableId={lead.id} index={idx} key={lead.id}>
                  {(dp, ds) => (
                    <div
                      ref={dp.innerRef}
                      {...dp.draggableProps}
                      {...dp.dragHandleProps}
                      className={ds.isDragging ? 'shadow-lg' : ''}
                    >
                      <LeadCard
                        lead={lead}
                        density={density}
                        selected={selectedIds.has(lead.id)}
                        onToggleSelect={onToggleSelect}
                        onContextMenu={onContextMenu}
                        onPauseDrip={onPauseDrip}
                        anyCardSelectedInBoard={anyCardSelectedInBoard}
                        seenRecentMoveRef={seenRecentMoveRef}
                      />
                    </div>
                  )}
                </Draggable>
              ))
            )}
            {provided.placeholder}
            {sorted.length > 0 && onAddLead && (
              <button
                type="button"
                onClick={() => onAddLead(stage.id)}
                className="w-full mt-1 text-[11px] px-2 py-1 rounded border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600"
              >
                + Add Lead
              </button>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
