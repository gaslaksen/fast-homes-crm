'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { KanbanLead } from './types';

interface Props {
  lead: KanbanLead;
  x: number;
  y: number;
  onClose: () => void;
  onMarkDead: (id: string) => void | Promise<void>;
}

export default function CardContextMenu({
  lead,
  x,
  y,
  onClose,
  onMarkDead,
}: Props) {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-card-context-menu]')) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const go = (path: string) => {
    router.push(path);
    onClose();
  };

  const copyAddr = async () => {
    try {
      await navigator.clipboard.writeText(lead.propertyAddress);
    } catch {
      /* ignore */
    }
    onClose();
  };

  return (
    <div
      data-card-context-menu
      className="fixed z-50 min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1 text-sm"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        onClick={() => go(`/leads/${lead.id}`)}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Open lead
      </button>
      <button
        type="button"
        onClick={() => go(`/leads/${lead.id}#messages`)}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Send SMS…
      </button>
      {lead.sellerPhone && (
        <a
          href={`tel:${lead.sellerPhone}`}
          onClick={onClose}
          className="block px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Call seller
        </a>
      )}
      <button
        type="button"
        onClick={() => go(`/leads/${lead.id}#followup`)}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Schedule follow-up
      </button>
      <button
        type="button"
        onClick={() => go(`/leads/${lead.id}#offer`)}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Send offer
      </button>
      <button
        type="button"
        onClick={() => go(`/leads/${lead.id}#share`)}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Share with partners
      </button>
      <button
        type="button"
        onClick={copyAddr}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Copy address
      </button>
      <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
      <button
        type="button"
        onClick={() => {
          onMarkDead(lead.id);
          onClose();
        }}
        className="w-full text-left px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
      >
        Mark dead
      </button>
    </div>
  );
}
