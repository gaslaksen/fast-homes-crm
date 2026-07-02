'use client';

import { useEffect, useRef, useState } from 'react';
import { messagesAPI, leadsAPI } from '@/lib/api';

type Channel = 'sms' | 'email' | 'comment';

interface TeamMember {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

const CHANNELS: { key: Channel; label: string; icon: string }[] = [
  { key: 'sms', label: 'SMS', icon: '💬' },
  { key: 'email', label: 'Email', icon: '✉' },
  { key: 'comment', label: 'Internal Comment', icon: '👁' },
];

function memberName(m: TeamMember): string {
  return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email || 'User';
}

export default function MessageComposer({
  leadId,
  sellerPhone,
  sellerEmail,
  gmailConnected,
  currentUser,
  teamMembers,
  doNotContact,
  seedBody,
  onSent,
}: {
  leadId: string;
  sellerPhone?: string | null;
  sellerEmail?: string | null;
  gmailConnected?: boolean;
  currentUser: any;
  teamMembers: TeamMember[];
  doNotContact?: boolean;
  seedBody?: string;
  onSent: () => void | Promise<void>;
}) {
  const [channel, setChannel] = useState<Channel>('sms');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SMS / comment body
  const [body, setBody] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);

  // Email fields (recipient is always the lead's sellerEmail, shown read-only)
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  // @mention state (comment mode)
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Seed the SMS body from a parent-supplied draft (e.g. ?action=reply intent).
  useEffect(() => {
    if (seedBody && seedBody.trim()) {
      setChannel('sms');
      setBody(seedBody);
    }
  }, [seedBody]);

  const reset = () => {
    setBody('');
    setEmailSubject('');
    setEmailBody('');
    setMentions([]);
    setMentionQuery(null);
    setError(null);
  };

  const generateDraft = async () => {
    setDraftLoading(true);
    try {
      const res = await messagesAPI.draft(leadId);
      const msg = (res.data as any)?.message;
      if (typeof msg === 'string') setBody(msg);
    } catch {
      // leave body
    } finally {
      setDraftLoading(false);
    }
  };

  // Track an in-progress "@token" so we can show mention suggestions.
  const onCommentChange = (value: string) => {
    setBody(value);
    const el = bodyRef.current;
    const caret = el ? el.selectionStart : value.length;
    const upToCaret = value.slice(0, caret);
    const match = upToCaret.match(/@([\w.'-]*)$/);
    setMentionQuery(match ? match[1].toLowerCase() : null);
  };

  const applyMention = (m: TeamMember) => {
    const el = bodyRef.current;
    const caret = el ? el.selectionStart : body.length;
    const upToCaret = body.slice(0, caret);
    const rest = body.slice(caret);
    const replaced = upToCaret.replace(/@([\w.'-]*)$/, `@${memberName(m)} `);
    setBody(replaced + rest);
    setMentions((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]));
    setMentionQuery(null);
    setTimeout(() => bodyRef.current?.focus(), 0);
  };

  const mentionMatches =
    mentionQuery == null
      ? []
      : teamMembers
          .filter((m) => memberName(m).toLowerCase().includes(mentionQuery))
          .slice(0, 6);

  const send = async () => {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      if (channel === 'sms') {
        if (!body.trim()) return;
        await messagesAPI.send(leadId, body, currentUser?.id);
      } else if (channel === 'email') {
        if (!emailSubject.trim() || !emailBody.trim() || !currentUser?.id) return;
        // Sends from the logged-in user to the lead's email, via Mailgun.
        await messagesAPI.sendEmail(leadId, {
          userId: currentUser.id,
          subject: emailSubject,
          body: emailBody,
        });
      } else {
        if (!body.trim() || !currentUser) return;
        await leadsAPI.addNote(leadId, body, currentUser.id, {
          isInternalComment: true,
          mentions,
        });
      }
      reset();
      await onSent();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const blockedBySms = channel === 'sms' && doNotContact;
  const isComment = channel === 'comment';

  return (
    <div
      className={`border-t px-4 py-3 space-y-2 ${
        isComment
          ? 'border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      {/* Channel pick-box */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span>{CHANNELS.find((c) => c.key === channel)?.icon}</span>
            {CHANNELS.find((c) => c.key === channel)?.label}
            <span className="text-gray-400">▾</span>
          </button>
          {pickerOpen && (
            <div className="absolute z-50 bottom-full mb-1 left-0 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
              {CHANNELS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setChannel(c.key);
                    setPickerOpen(false);
                    setError(null);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    channel === c.key ? 'text-teal-700 dark:text-teal-400 font-semibold' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span>{c.icon}</span>
                  {c.label}
                  {channel === c.key && <span className="ml-auto text-teal-600">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {channel === 'sms' && (
          <button
            type="button"
            onClick={generateDraft}
            disabled={draftLoading || sending || doNotContact}
            className="text-xs text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50"
          >
            {draftLoading ? 'Generating…' : '✨ AI draft'}
          </button>
        )}
      </div>

      {/* Email channel — sends from the logged-in user via Mailgun */}
      {channel === 'email' && !sellerEmail ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          This lead has no email address on file. Add one to send email.
        </div>
      ) : channel === 'email' ? (
        <div className="space-y-2">
          <input
            type="email"
            value={sellerEmail || ''}
            readOnly
            className="input w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-500"
            placeholder="To"
          />
          <input
            type="text"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            className="input w-full text-sm"
            placeholder="Subject"
          />
          <textarea
            className="input w-full text-sm"
            rows={3}
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="Write an email…"
          />
        </div>
      ) : (
        <div className="relative">
          <textarea
            ref={bodyRef}
            className="input w-full text-sm"
            rows={3}
            value={body}
            onChange={(e) => (isComment ? onCommentChange(e.target.value) : setBody(e.target.value))}
            disabled={sending}
            placeholder={
              isComment
                ? '@ to tag teammates. Internal comment - visible only to your team.'
                : blockedBySms
                  ? 'This lead is Do Not Contact.'
                  : 'Type a message…'
            }
          />
          {isComment && mentionMatches.length > 0 && (
            <div className="absolute z-10 bottom-full mb-1 left-0 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
              {mentionMatches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => applyMention(m)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  @{memberName(m)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={send}
          disabled={
            sending ||
            blockedBySms ||
            (channel === 'email' && !sellerEmail) ||
            (channel === 'email'
              ? !emailSubject.trim() || !emailBody.trim()
              : !body.trim())
          }
          className={`btn btn-sm ${isComment ? 'btn-secondary' : 'btn-primary'} disabled:opacity-50`}
        >
          {sending ? 'Sending…' : isComment ? 'Post comment' : 'Send'}
        </button>
      </div>
    </div>
  );
}
