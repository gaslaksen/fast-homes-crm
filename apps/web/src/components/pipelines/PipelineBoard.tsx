'use client';

import { ReactNode, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

/**
 * The shared board for every acquisition pipeline: Surplus Funds, Tax Sales,
 * Probate, Foreclosures.
 *
 * ── Why a new component and not the Leads one ───────────────────────────────
 *
 * `listViewV2/ListTable` is typed to `ListLead` with a fixed `SortKey`, and
 * `kanbanV2/KanbanV2Board` fetches its own leads and owns its own URL state.
 * Neither can render a surplus property, a tax sale or a probate heir without
 * being rewritten around them. This takes the shape they proved works, a table
 * for scanning and a kanban for moving, and makes the row type the caller's
 * business.
 *
 * ── What a pipeline supplies ────────────────────────────────────────────────
 *
 * Columns for the table, stages for the kanban, and a card renderer. Nothing
 * here knows what a surplus claim or a probate heir is, which is the point:
 * adding a pipeline should be a config object, not another board.
 *
 * Sorting, selection and drag-to-restage are handled here because every
 * pipeline wants them and none of them wants to reimplement them.
 */

export type PipelineView = 'table' | 'kanban' | 'cards';

export interface PipelineColumn<T> {
  key: string;
  label: string;
  /** Right-align money and counts; everything else reads better left. */
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
  /**
   * Value to sort on. Omit to make the column unsortable, which is right for
   * anything composite (a stack of chips, an action button).
   */
  sortValue?: (row: T) => string | number;
}

export interface PipelineStage {
  key: string;
  label: string;
  /** CSS colour for the column header rule. */
  tone?: string;
}

interface Props<T> {
  rows: T[];
  keyOf: (row: T) => string;
  columns: PipelineColumn<T>[];
  /** Kanban columns. Omit to hide the kanban view entirely. */
  stages?: PipelineStage[];
  stageOf?: (row: T) => string;
  /** Called when a card is dragged to another column. */
  onStageChange?: (row: T, stage: string) => void;

  view: PipelineView;
  onViewChange: (v: PipelineView) => void;

  selected: Record<string, boolean>;
  onSelect: (key: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;

  onOpen: (row: T) => void;
  /** The card, used by both the cards view and the kanban columns. */
  renderCard: (row: T) => ReactNode;
  /** Left border accent, so status reads at a glance in every view. */
  accentOf?: (row: T) => string;

  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
}

export default function PipelineBoard<T>({
  rows,
  keyOf,
  columns,
  stages,
  stageOf,
  onStageChange,
  view,
  onViewChange,
  selected,
  onSelect,
  onSelectAll,
  onOpen,
  renderCard,
  accentOf,
  toolbarLeft,
  toolbarRight,
  empty,
  loading,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    // No column chosen means the caller's own order stands, which is the
    // ranking it computed. Re-sorting by default would throw that away.
    if (!col?.sortValue) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, columns, sortKey, sortDir]);

  const allShown = rows.length > 0 && rows.every((r) => selected[keyOf(r)]);
  const chosenCount = rows.filter((r) => selected[keyOf(r)]).length;

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  };

  const byStage = useMemo(() => {
    if (!stages || !stageOf) return null;
    const map = new Map<string, T[]>(stages.map((s) => [s.key, []]));
    for (const r of sorted) {
      const k = stageOf(r);
      // A row in a stage the pipeline does not list still has to go somewhere,
      // or it silently vanishes off the board.
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  }, [sorted, stages, stageOf]);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !onStageChange) return;
    const to = result.destination.droppableId;
    if (to === result.source.droppableId) return;
    const row = rows.find((r) => keyOf(r) === result.draggableId);
    if (row) onStageChange(row, to);
  };

  return (
    <div>
      <div className="dc-pb-toolbar">
        <div className="dc-pb-toolbar-left">{toolbarLeft}</div>

        <div className="dc-seg" role="group" aria-label="View">
          <button className={view === 'table' ? 'on' : ''} onClick={() => onViewChange('table')}>
            Table
          </button>
          {stages && (
            <button className={view === 'kanban' ? 'on' : ''} onClick={() => onViewChange('kanban')}>
              Board
            </button>
          )}
          <button className={view === 'cards' ? 'on' : ''} onClick={() => onViewChange('cards')}>
            Cards
          </button>
        </div>

        <div className="dc-seg">
          <button className={allShown ? 'on' : ''} onClick={() => onSelectAll(true)}>
            Select all
          </button>
          <button className={chosenCount === 0 ? 'on' : ''} onClick={() => onSelectAll(false)}>
            Deselect
          </button>
        </div>

        <div className="dc-pb-toolbar-right">{toolbarRight}</div>
      </div>

      {loading ? (
        <div className="dc-pb-empty">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="dc-pb-empty">{empty || 'Nothing here yet.'}</div>
      ) : view === 'table' ? (
        <div className="dc-pb-tablewrap">
          <table className="dc-pb-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allShown}
                    onChange={(e) => onSelectAll(e.target.checked)}
                    aria-label="Select all rows"
                  />
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={{ width: c.width, textAlign: c.align || 'left' }}
                    className={c.sortValue ? 'sortable' : undefined}
                    onClick={c.sortValue ? () => toggleSort(c.key) : undefined}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="dir">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const k = keyOf(r);
                return (
                  <tr
                    key={k}
                    className={selected[k] ? 'pick' : undefined}
                    style={accentOf ? { borderLeft: `3px solid ${accentOf(r)}` } : undefined}
                    onClick={() => onOpen(r)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!selected[k]}
                        onChange={(e) => onSelect(k, e.target.checked)}
                        aria-label="Select row"
                      />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align || 'left' }}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === 'kanban' && byStage && stages ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="dc-pb-kanban">
            {stages.map((s) => {
              const items = byStage.get(s.key) || [];
              return (
                <Droppable droppableId={s.key} key={s.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`dc-pb-col${snapshot.isDraggingOver ? ' over' : ''}`}
                    >
                      <div className="dc-pb-colhead" style={{ borderTopColor: s.tone || 'var(--border2)' }}>
                        <span>{s.label}</span>
                        <b>{items.length}</b>
                      </div>
                      <div className="dc-pb-colbody">
                        {items.map((r, i) => (
                          <Draggable draggableId={keyOf(r)} index={i} key={keyOf(r)}>
                            {(dp, ds) => (
                              <div
                                ref={dp.innerRef}
                                {...dp.draggableProps}
                                {...dp.dragHandleProps}
                                className={ds.isDragging ? 'dragging' : undefined}
                              >
                                {renderCard(r)}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <div className="dc-pb-cards">{sorted.map((r) => <div key={keyOf(r)}>{renderCard(r)}</div>)}</div>
      )}
    </div>
  );
}
