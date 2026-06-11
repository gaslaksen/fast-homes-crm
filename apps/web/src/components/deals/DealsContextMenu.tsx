'use client';

// Right-click menu for deal table rows. Lightweight; mirrors the pattern
// used in kanbanV2/CardContextMenu.tsx (fixed-position div, click-outside +
// Escape to dismiss, no library). State-changing actions navigate to the
// Disposition tab so the existing dispoV2 sections handle the actual write.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { DealStageId } from '@/lib/dealStages';

interface Props {
  x: number;
  y: number;
  dealId: string;
  status: DealStageId | string;
  onClose: () => void;
}

export default function DealsContextMenu({ x, y, dealId, status, onClose }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const canMarkSold =
    status === 'ACQUIRED' || status === 'UNDER_CONTRACT' || status === 'CLOSING';
  const canMarkHeld = canMarkSold;
  const canCancel =
    status !== 'SOLD' &&
    status !== 'SOLD_LOSS' &&
    status !== 'HELD_LONG_TERM' &&
    status !== 'CANCELLED';

  const go = (path: string) => {
    router.push(path);
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="fixed z-50 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      role="menu"
    >
      <MenuItem onClick={() => go(`/leads/${dealId}`)}>Open lead</MenuItem>
      <MenuItem onClick={() => go(`/leads/${dealId}?tab=disposition`)}>Open disposition</MenuItem>
      <Divider />
      {canMarkSold ? (
        <MenuItem
          onClick={() => go(`/leads/${dealId}?tab=disposition&action=mark-sold`)}
        >
          Mark as Sold…
        </MenuItem>
      ) : null}
      {canMarkHeld ? (
        <MenuItem
          onClick={() => go(`/leads/${dealId}?tab=disposition&action=mark-held`)}
        >
          Mark as Held…
        </MenuItem>
      ) : null}
      {canCancel ? (
        <MenuItem
          onClick={() => go(`/leads/${dealId}?tab=disposition&action=mark-cancelled`)}
        >
          Mark as Cancelled…
        </MenuItem>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-gray-100 dark:border-gray-800" />;
}
