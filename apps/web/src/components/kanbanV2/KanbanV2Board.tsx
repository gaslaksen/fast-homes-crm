'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { PIPELINE_STAGES } from '@/lib/pipelineStages';
import {
  pipelineAPI,
  campaignsAPI,
  leadsAPI,
  authAPI,
} from '@/lib/api';
import { useKanbanPrefs, DEFAULT_SORT } from './hooks/useKanbanPrefs';
import BoardScrollShell from './BoardScrollShell';
import StageColumn from './StageColumn';
import BulkActionBar from './BulkActionBar';
import CardContextMenu from './CardContextMenu';
import type { Density, KanbanLead, LeadsByStage } from './types';

export default function KanbanV2Board() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    authAPI
      .getMe()
      .then((res) => setUserId(res.data?.id || res.data?.userId))
      .catch(() => setUserId('anon'));
  }, []);

  // Mobile fallback: switch to table view on narrow screens (<768px).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 768) return;
    const sp = new URLSearchParams(params.toString());
    sp.set('view', 'table');
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefs = useKanbanPrefs(userId);
  const seenRecentMoveRef = useRef<Set<string>>(new Set());

  // URL-state overrides
  const urlDensity = params.get('density') as Density | null;
  const urlCollapsed = (params.get('collapsed') || '')
    .split(',')
    .filter(Boolean);
  const urlInDrip = params.get('inDrip') === 'active';

  // Apply URL state to prefs (read-only — URL wins on first load)
  useEffect(() => {
    if (!prefs.hydrated) return;
    if (urlDensity && urlDensity !== prefs.density) {
      prefs.setDensity(urlDensity);
    }
    if (urlCollapsed.length) {
      prefs.setCollapsed(new Set(urlCollapsed));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.hydrated]);

  // Data
  const [data, setData] = useState<LeadsByStage>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ lead: KanbanLead; x: number; y: number } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const { data: res } = await pipelineAPI.get();
      setData(res.leadsByStage || {});
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const { data: res } = await campaignsAPI.list();
      const arr = Array.isArray(res) ? res : res?.campaigns || [];
      setCampaigns(
        arr.map((c: any) => ({ id: c.id, name: c.name })).filter((c: any) => c.id && c.name),
      );
    } catch {
      setCampaigns([]);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchCampaigns();
  }, [fetchData, fetchCampaigns]);

  // Apply In-Drip filter (client-side, since the pipeline endpoint doesn't yet take it)
  const filteredData = useMemo<LeadsByStage>(() => {
    if (!urlInDrip) return data;
    const result: LeadsByStage = {};
    for (const [k, arr] of Object.entries(data)) {
      result[k] = arr.filter(
        (l) =>
          (l.campaignEnrollments && l.campaignEnrollments.length > 0) ||
          l.dripSequence?.status === 'ACTIVE',
      );
    }
    return result;
  }, [data, urlInDrip]);

  const allSelectedLeads: KanbanLead[] = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const out: KanbanLead[] = [];
    for (const arr of Object.values(data)) {
      for (const lead of arr) {
        if (selectedIds.has(lead.id)) out.push(lead);
      }
    }
    return out;
  }, [selectedIds, data]);

  // Drag end → persist stage change, optimistic UI
  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    const nextData: LeadsByStage = {};
    for (const [k, arr] of Object.entries(data)) {
      nextData[k] = [...arr];
    }
    const srcArr = nextData[source.droppableId] || [];
    const idx = srcArr.findIndex((l) => l.id === draggableId);
    if (idx === -1) return;
    const [moved] = srcArr.splice(idx, 1);
    const destArr = nextData[destination.droppableId] || [];
    destArr.splice(destination.index, 0, {
      ...moved,
      status: destination.droppableId,
      stageChangedAt: new Date().toISOString(),
    });
    nextData[destination.droppableId] = destArr;
    setData(nextData);

    try {
      await pipelineAPI.updateStage(draggableId, destination.droppableId);
    } catch {
      fetchData();
    }
  };

  // Selection helpers
  const lastClickRef = useRef<{ stage: string; id: string } | null>(null);
  const toggleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        // Shift-click range within column
        if (e.shiftKey && lastClickRef.current) {
          const last = lastClickRef.current;
          for (const [stage, arr] of Object.entries(data)) {
            if (stage !== last.stage) continue;
            const a = arr.findIndex((l) => l.id === last.id);
            const b = arr.findIndex((l) => l.id === id);
            if (a !== -1 && b !== -1) {
              const [lo, hi] = a < b ? [a, b] : [b, a];
              for (let i = lo; i <= hi; i++) next.add(arr[i].id);
            }
          }
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        // Track the stage the clicked id lives in
        for (const [stage, arr] of Object.entries(data)) {
          if (arr.some((l) => l.id === id)) {
            lastClickRef.current = { stage, id };
            break;
          }
        }
        return next;
      });
    },
    [data],
  );

  const selectAllInColumn = useCallback(
    (stageId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const lead of data[stageId] || []) next.add(lead.id);
        return next;
      });
    },
    [data],
  );

  const clearSelection = () => setSelectedIds(new Set());

  // Escape to clear selection (also handled inside BulkActionBar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
        setCtxMenu(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // URL state writers
  const updateUrl = useCallback(
    (patch: { density?: Density; collapsed?: string[]; inDrip?: boolean }) => {
      const sp = new URLSearchParams(params.toString());
      if (patch.density) sp.set('density', patch.density);
      if (patch.collapsed) {
        if (patch.collapsed.length) sp.set('collapsed', patch.collapsed.join(','));
        else sp.delete('collapsed');
      }
      if ('inDrip' in patch) {
        if (patch.inDrip) sp.set('inDrip', 'active');
        else sp.delete('inDrip');
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, router, pathname],
  );

  const handleSetDensity = (d: Density) => {
    prefs.setDensity(d);
    updateUrl({ density: d });
  };
  const handleToggleCollapse = (stage: string) => {
    const next = new Set(prefs.collapsed);
    if (next.has(stage)) next.delete(stage);
    else next.add(stage);
    prefs.setCollapsed(next);
    updateUrl({ collapsed: Array.from(next) });
  };
  const handleCollapseEmpty = () => {
    const next = new Set(prefs.collapsed);
    for (const s of PIPELINE_STAGES) {
      if (!(filteredData[s.id] || []).length) next.add(s.id);
    }
    prefs.setCollapsed(next);
    updateUrl({ collapsed: Array.from(next) });
  };
  const handleExpandAll = () => {
    prefs.setCollapsed(new Set());
    updateUrl({ collapsed: [] });
  };
  const handleToggleInDrip = () => {
    updateUrl({ inDrip: !urlInDrip });
  };

  // Drip pause (single lead)
  const handlePauseDrip = async (leadId: string, enrollmentId: string | null) => {
    try {
      if (enrollmentId) {
        await campaignsAPI.pauseEnrollment(enrollmentId);
      } else {
        await leadsAPI.cancelDrip(leadId, 'Paused from Kanban');
      }
      fetchData();
    } catch {
      /* ignore */
    }
  };

  // Bulk ops
  const bulkMoveStage = async (ids: string[], stage: string) => {
    try {
      await pipelineAPI.bulkUpdateStage(ids, stage);
    } finally {
      fetchData();
    }
  };
  const bulkMarkDead = async (ids: string[]) => {
    try {
      await leadsAPI.bulkUpdateStatus(ids, 'DEAD');
    } finally {
      fetchData();
    }
  };
  const bulkEnrollDrip = async (ids: string[], campaignId: string) => {
    await Promise.allSettled(
      ids.map((id) => campaignsAPI.enroll(campaignId, id)),
    );
    fetchData();
  };
  const bulkPauseDrip = async (ids: string[]) => {
    // Pause any active enrollment or cancel legacy drip, per lead
    const tasks: Promise<any>[] = [];
    for (const id of ids) {
      const lead = allSelectedLeads.find((l) => l.id === id);
      if (!lead) continue;
      const enr = lead.campaignEnrollments[0];
      if (enr) {
        tasks.push(campaignsAPI.pauseEnrollment(enr.id));
      } else if (lead.dripSequence?.status === 'ACTIVE') {
        tasks.push(leadsAPI.cancelDrip(id, 'Bulk paused from Kanban'));
      }
    }
    await Promise.allSettled(tasks);
    fetchData();
  };

  // Context menu open
  const handleContextMenu = (e: React.MouseEvent, lead: KanbanLead) => {
    e.preventDefault();
    setCtxMenu({ lead, x: e.clientX, y: e.clientY });
  };

  const handleSingleMarkDead = async (leadId: string) => {
    try {
      await leadsAPI.bulkUpdateStatus([leadId], 'DEAD');
    } finally {
      fetchData();
    }
  };

  const handleAddLead = (stageId: string) => {
    router.push(`/leads?new=1&stage=${stageId}`);
  };

  // Early return while loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-gray-400">
        Loading Kanban…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-red-500">
        {error}
      </div>
    );
  }

  const inDripCount = Object.values(data)
    .flat()
    .filter(
      (l) =>
        (l.campaignEnrollments && l.campaignEnrollments.length > 0) ||
        l.dripSequence?.status === 'ACTIVE',
    ).length;

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
          {(['comfortable', 'compact', 'ultra'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleSetDensity(d)}
              className={`px-2.5 py-1 ${
                prefs.density === d
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {d === 'comfortable' ? 'Comfort' : d === 'compact' ? 'Compact' : 'Ultra'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCollapseEmpty}
          className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Collapse empty
        </button>
        <button
          type="button"
          onClick={handleExpandAll}
          className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Expand all
        </button>

        <button
          type="button"
          onClick={handleToggleInDrip}
          className={`text-xs px-2.5 py-1 rounded border ${
            urlInDrip
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title="Show only leads with an active drip campaign"
        >
          ✉ In Drip ({inDripCount})
        </button>
      </div>

      {/* Board */}
      <DragDropContext onDragEnd={onDragEnd}>
        <BoardScrollShell>
          {PIPELINE_STAGES.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              leads={filteredData[stage.id] || []}
              density={prefs.density}
              collapsed={prefs.collapsed.has(stage.id)}
              onToggleCollapse={() => handleToggleCollapse(stage.id)}
              sortKey={prefs.columnSort[stage.id] || DEFAULT_SORT}
              onSortChange={(k) => prefs.setColumnSort(stage.id, k)}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelectAllInColumn={selectAllInColumn}
              anyCardSelectedInBoard={selectedIds.size > 0}
              onContextMenu={handleContextMenu}
              onPauseDrip={handlePauseDrip}
              onAddLead={handleAddLead}
              seenRecentMoveRef={seenRecentMoveRef}
            />
          ))}
        </BoardScrollShell>
      </DragDropContext>

      {/* Bulk action bar */}
      <BulkActionBar
        selectedLeads={allSelectedLeads}
        onClear={clearSelection}
        onBulkMoveStage={bulkMoveStage}
        onBulkMarkDead={bulkMarkDead}
        onBulkEnrollDrip={bulkEnrollDrip}
        onBulkPauseDrip={bulkPauseDrip}
        campaigns={campaigns}
      />

      {/* Context menu */}
      {ctxMenu && (
        <CardContextMenu
          lead={ctxMenu.lead}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onMarkDead={handleSingleMarkDead}
        />
      )}
    </div>
  );
}
