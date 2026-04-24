'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Density } from '../types';

export interface UrlState {
  density: Density | null;
  collapsed: string[];
  inDrip: boolean;
}

export function useKanbanUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const read = useCallback((): UrlState => {
    const densityRaw = params.get('density') as Density | null;
    const density: Density | null =
      densityRaw === 'comfortable' || densityRaw === 'compact' || densityRaw === 'ultra'
        ? densityRaw
        : null;
    const collapsedRaw = params.get('collapsed') || '';
    const collapsed = collapsedRaw ? collapsedRaw.split(',').filter(Boolean) : [];
    const inDrip = params.get('inDrip') === 'active';
    return { density, collapsed, inDrip };
  }, [params]);

  const write = useCallback(
    (next: Partial<UrlState>) => {
      const sp = new URLSearchParams(params.toString());
      if ('density' in next) {
        if (next.density) sp.set('density', next.density);
        else sp.delete('density');
      }
      if ('collapsed' in next) {
        if (next.collapsed && next.collapsed.length) {
          sp.set('collapsed', next.collapsed.join(','));
        } else {
          sp.delete('collapsed');
        }
      }
      if ('inDrip' in next) {
        if (next.inDrip) sp.set('inDrip', 'active');
        else sp.delete('inDrip');
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, router, pathname],
  );

  return { read, write };
}
