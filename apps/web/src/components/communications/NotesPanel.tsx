'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import type { NoteItem } from './types';

export default function NotesPanel({
  notes,
  onAddNote,
  canAdd = true,
}: {
  notes: NoteItem[];
  onAddNote?: (text: string) => Promise<void>;
  canAdd?: boolean;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim() || !onAddNote || saving) return;
    setSaving(true);
    try {
      await onAddNote(text.trim());
      setText('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        Notes &amp; call summaries
      </div>

      {onAddNote && (
        <div className="mb-3">
          <textarea
            className="input w-full text-sm"
            rows={2}
            placeholder={canAdd ? 'Add a note…' : 'Sign in to add notes'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!canAdd || saving}
          />
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={submit}
              disabled={!canAdd || saving || !text.trim()}
              className="btn btn-primary btn-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2">
        {notes.length === 0 && (
          <div className="text-xs text-gray-400 dark:text-gray-500">No notes yet.</div>
        )}
        {notes.map((n) => (
          <div
            key={n.id}
            className={`rounded-lg p-3 text-sm border ${
              n.kind === 'call_summary'
                ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-100 dark:border-teal-900/40'
                : 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                {n.kind === 'call_summary' ? '🤖 AI call summary' : `📝 ${n.actor.name}`}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {format(new Date(n.at), 'MMM d, h:mm a')}
              </span>
            </div>
            {n.body && (
              <div className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {n.body}
              </div>
            )}
            {n.transcript && (
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === n.id ? null : n.id)}
                className="mt-1 text-[11px] text-teal-700 dark:text-teal-400 hover:underline"
              >
                {expandedId === n.id ? 'Hide transcript' : 'View transcript'}
              </button>
            )}
            {n.transcript && expandedId === n.id && (
              <div className="mt-2 p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {n.transcript}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
