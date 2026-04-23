'use client';

import { useEffect, useState } from 'react';
import { actionsAPI } from '@/lib/api';

export interface ActionBadges {
  needsReply: number;
  newLeads: number;
  unseenCount: number;
}

const POLL_MS = 60_000;

// Polls /actions/badges on mount and every 60s. Returns counts for sidebar
// wiring (Inbox → needsReply, Leads → newLeads, future notifications →
// unseenCount).
export function useActionBadges(): ActionBadges {
  const [badges, setBadges] = useState<ActionBadges>({
    needsReply: 0,
    newLeads: 0,
    unseenCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await actionsAPI.badges();
        if (cancelled) return;
        const data = res.data || {};
        setBadges({
          needsReply: data.needsReply ?? 0,
          newLeads: data.newLeads ?? 0,
          unseenCount: data.unseenCount ?? 0,
        });
      } catch {
        // Silent: badges default to 0.
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return badges;
}
