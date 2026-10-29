'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { leadsAPI } from '@/lib/api';
import type { NoteItem } from './types';

export default function NotesPanel({
  notes,
  onAddNote,
  canAdd = true,
  leadId,
  currentUser,
  onNotesChanged,
}: {
  notes: NoteItem[];
  onAddNote?: (text: string) => Promise<void>;
  canAdd?: boolean;
  /**
   * With these three a saved note can be edited or deleted by whoever wrote
   * it, or by an admin. The API checks the same rule; this only decides who
   * sees the buttons. Call summaries are never editable.
   */
  leadId?: string;
  currentUser?: { id?: string; role?: string } | null;
  onNotesChanged?: () => unknown;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const canChange = (n: NoteItem) =>
    n.kind === 'note' &&
    !!leadId &&
    !!onNotesChanged &&
    !!currentUser?.id &&
    (n.authorId === currentUser.id || currentUser.role === 'ADMIN');

  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id);
    setProblem(null);
    try {
      await work();
      setEditingId(null);
      setConfirmId(null);
      await onNotesChanged?.();
    } catch (e: any) {
      setProblem(e?.response?.data?.message || 'That note could not be changed.');
    } finally {
      setBusyId(null);
    }
  };
  const saveEdit = (n: NoteItem) => {
    const body = draft.trim();
    if (!body || !leadId || body === (n.body || '').trim()) {
      if (body) setEditingId(null);
      return;
    }
    run(n.id, () => leadsAPI.editNote(leadId, n.id, body));
  };
  const remove = (n: NoteItem) => leadId && run(n.id, () => leadsAPI.deleteNote(leadId, n.id));

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
        {problem && <div className="text-xs text-red-600 dark:text-red-400">{problem}</div>}
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
                {n.editedAt && (
                  <span title={`Edited ${format(new Date(n.editedAt), 'MMM d, h:mm a')}`}> · edited</span>
                )}
              </span>
            </div>
            {editingId === n.id ? (
              <div>
                <textarea
                  className="input w-full text-sm"
                  rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busyId === n.id}
                  autoFocus
                  aria-label="Edit note"
                />
                <div className="flex justify-end gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={busyId === n.id}
                    className="btn btn-secondary btn-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(n)}
                    disabled={busyId === n.id || !draft.trim()}
                    className="btn btn-primary btn-sm disabled:opacity-50"
                  >
                    {busyId === n.id ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              n.body && (
                <div className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {n.body}
                </div>
              )
            )}
            {canChange(n) && editingId !== n.id && (
              // Colours sit on the row and on spans, not on the buttons: inside the
              // pipeline boards `.dc-board button` resets a button's colour.
              <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {confirmId === n.id ? (
                  <>
                    <span>Delete this note?</span>
                    <button
                      type="button"
                      onClick={() => remove(n)}
                      disabled={busyId === n.id}
                      className="font-semibold hover:underline"
                    >
                      <span className="text-red-600 dark:text-red-400">{busyId === n.id ? 'Deleting…' : 'Delete'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="hover:underline"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(n.body || '');
                        setEditingId(n.id);
                        setConfirmId(null);
                      }}
                      className="hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(n.id);
                        setEditingId(null);
                      }}
                      className="hover:underline"
                    >
                      Delete
                    </button>
                  </>
                )}
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
