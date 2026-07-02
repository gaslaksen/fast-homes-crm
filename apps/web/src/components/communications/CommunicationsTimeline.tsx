'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import Avatar from '@/components/Avatar';
import LightboxOverlay, { type LightboxPhoto } from '@/components/LightboxOverlay';
import type { Actor, TimelineItem } from './types';
import type { EmailAction } from './MessageComposer';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Build a Gmail-style quoted block from an email timeline item.
function quoteEmail(item: Extract<TimelineItem, { kind: 'email' }>): string {
  const who = item.direction === 'OUTBOUND' ? item.payload.toAddress : item.payload.fromAddress;
  const when = format(new Date(item.at), "PPP 'at' p");
  const inner = escapeHtml(item.payload.bodyText || '').replace(/\n/g, '<br>');
  return (
    `<p>On ${escapeHtml(when)}, ${escapeHtml(who || '')} wrote:</p>` +
    `<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555;">${inner}</blockquote>`
  );
}

function withPrefix(subject: string, prefix: 'Re' | 'Fwd'): string {
  const s = subject || '(no subject)';
  const re = new RegExp(`^${prefix}:`, 'i');
  return re.test(s.trim()) ? s : `${prefix}: ${s}`;
}

// Strip the "email_" timeline-id prefix back to the raw Email row id.
function rawEmailId(timelineId: string): string {
  return timelineId.replace(/^email_/, '');
}

// Placeholder body the webhook stores for MMS-only messages (no caption).
// Kept in sync with apps/api webhooks.controller.ts.
const MMS_PLACEHOLDER = '[📷 Photo]';

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// Twilio recordings are served via our authenticated proxy; <audio> can't send
// an Authorization header, so pass the JWT as a query param for those URLs.
function recordingSrc(url: string): string {
  if (!url.includes('/calls/twilio/recording-media/')) return url;
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

// AI/System get a fixed-color initials chip; users/sellers hash by name.
function ActorAvatar({ actor }: { actor: Actor }) {
  if (actor.type === 'ai') {
    return (
      <span
        title="AI"
        className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-white bg-teal-600 flex-shrink-0"
      >
        AI
      </span>
    );
  }
  if (actor.type === 'system') {
    return (
      <span
        title="System"
        className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-white bg-gray-500 flex-shrink-0"
      >
        SYS
      </span>
    );
  }
  return <Avatar name={actor.name} avatarUrl={actor.type === 'user' ? actor.avatarUrl : null} size="sm" />;
}

// Consistent, larger channel badge so SMS / Email / Call are easy to tell apart.
const CHANNEL_META: Record<'sms' | 'email' | 'call', { icon: string; cls: string; label: string }> = {
  sms: {
    icon: '💬',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    label: 'Text',
  },
  email: {
    icon: '✉️',
    cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    label: 'Email',
  },
  call: {
    icon: '📞',
    cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    label: 'Call',
  },
};

function ChannelBadge({ kind }: { kind: 'sms' | 'email' | 'call' }) {
  const m = CHANNEL_META[kind];
  return (
    <span
      title={m.label}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-base flex-shrink-0 ${m.cls}`}
    >
      {m.icon}
    </span>
  );
}

function MetaLine({ actor, at }: { actor: Actor; at: string }) {
  return (
    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
      {actor.name} • {format(new Date(at), 'MMM d, h:mm a')}
    </span>
  );
}

// Bold any @mention tokens in an internal comment.
function renderWithMentions(body: string) {
  const parts = body.split(/(@[\w.'-]+(?:\s+[\w.'-]+)?)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-semibold text-amber-700 dark:text-amber-400">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function CommunicationsTimeline({
  items,
  onEmailAction,
}: {
  items: TimelineItem[];
  onEmailAction?: (action: EmailAction) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const emailItems = items.filter(
    (i): i is Extract<TimelineItem, { kind: 'email' }> => i.kind === 'email',
  );

  const replyTo = (item: Extract<TimelineItem, { kind: 'email' }>) =>
    onEmailAction?.({
      nonce: Date.now(),
      mode: 'reply',
      subject: withPrefix(item.payload.subject, 'Re'),
      bodyHtml: `<p><br></p><p><br></p>${quoteEmail(item)}`,
      inReplyToEmailId: rawEmailId(item.id),
    });

  const forwardOne = (item: Extract<TimelineItem, { kind: 'email' }>) =>
    onEmailAction?.({
      nonce: Date.now(),
      mode: 'forward',
      subject: withPrefix(item.payload.subject, 'Fwd'),
      bodyHtml: `<p><br></p><p>---------- Forwarded message ----------</p>${quoteEmail(item)}`,
      to: '',
    });

  const forwardThread = (item: Extract<TimelineItem, { kind: 'email' }>) =>
    onEmailAction?.({
      nonce: Date.now(),
      mode: 'forward',
      subject: withPrefix(item.payload.subject, 'Fwd'),
      bodyHtml:
        `<p><br></p><p>---------- Forwarded conversation ----------</p>` +
        emailItems.map(quoteEmail).join('<hr>'),
      to: '',
    });

  if (items.length === 0) {
    return <div className="text-xs text-gray-400 dark:text-gray-500">No communications yet.</div>;
  }

  // Flatten every MMS photo in the thread into one gallery so the lightbox can
  // arrow across all of them. The per-message start index lets a thumbnail open
  // the lightbox at its own position.
  const galleryPhotos: LightboxPhoto[] = [];
  const mediaStartIndex = new Map<string, number>();
  for (const it of items) {
    if (it.kind === 'sms' && it.payload.media?.length) {
      mediaStartIndex.set(it.id, galleryPhotos.length);
      for (const m of it.payload.media) galleryPhotos.push({ url: m.url, source: 'MMS' });
    }
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const outbound = item.direction === 'OUTBOUND';
        const rowDir = outbound ? 'flex-row-reverse' : 'flex-row';

        if (item.kind === 'event') {
          return (
            <div key={item.id} className="flex items-center justify-center gap-2 py-1">
              <ActorAvatar actor={item.actor} />
              <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1 max-w-[80%] text-center">
                {item.payload.description}
                <span className="ml-2 text-gray-400 dark:text-gray-500">
                  {format(new Date(item.at), 'MMM d, h:mm a')}
                </span>
              </div>
            </div>
          );
        }

        if (item.kind === 'comment') {
          return (
            <div key={item.id} className="flex items-start gap-2 flex-row-reverse">
              <ActorAvatar actor={item.actor} />
              <div className="p-3 rounded-lg max-w-[min(80%,36rem)] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
                <div className="text-[10px] text-amber-700 dark:text-amber-400 mb-1 uppercase tracking-wide">
                  👁 Internal comment • {item.actor.name} • {format(new Date(item.at), 'MMM d, h:mm a')}
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                  {renderWithMentions(item.payload.body)}
                </div>
              </div>
            </div>
          );
        }

        // SMS — colored chat bubble.
        if (item.kind === 'sms') {
          const media = item.payload.media ?? [];
          // Hide the "[📷 Photo]" placeholder once the actual images are attached.
          const showBody = item.payload.body && !(media.length > 0 && item.payload.body === MMS_PLACEHOLDER);
          return (
            <div key={item.id} className={`flex items-start gap-2 ${rowDir}`}>
              <ActorAvatar actor={item.actor} />
              <div
                className={`p-3 rounded-lg max-w-[min(80%,36rem)] ${
                  outbound ? 'bg-primary-50 dark:bg-primary-900/30' : 'bg-gray-100 dark:bg-gray-800'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <ChannelBadge kind="sms" />
                  <MetaLine actor={item.actor} at={item.at} />
                </div>
                {media.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {media.map((m, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setLightboxIndex((mediaStartIndex.get(item.id) ?? 0) + i)}
                        title="View photo"
                        className="block"
                      >
                        <img
                          src={m.thumbnailUrl || m.url}
                          alt="MMS attachment"
                          className="max-h-48 w-auto rounded-lg border border-black/5 dark:border-white/10 object-cover hover:opacity-90 transition-opacity"
                        />
                      </button>
                    ))}
                  </div>
                )}
                {showBody && (
                  <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                    {item.payload.body}
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Email — distinct white card, full width of the thread.
        if (item.kind === 'email') {
          const expanded = expandedId === item.id;
          const emailItem = item as Extract<TimelineItem, { kind: 'email' }>;
          return (
            <div key={item.id} className="flex items-start gap-2">
              <ActorAvatar actor={item.actor} />
              <div className="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className="text-left w-full min-w-0 p-3"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <ChannelBadge kind="email" />
                    <MetaLine actor={item.actor} at={item.at} />
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {item.payload.subject || '(no subject)'}
                  </div>
                  {expanded ? (
                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <div className="text-[11px] text-gray-500 mb-1">
                        {outbound ? `To: ${item.payload.toAddress}` : `From: ${item.payload.fromAddress}`}
                      </div>
                      {item.payload.bodyText}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {item.payload.bodyText?.slice(0, 120)}
                      {item.payload.bodyText && item.payload.bodyText.length > 120 ? '…' : ''}
                    </div>
                  )}
                </button>
                {onEmailAction && (
                  <div className="flex items-center gap-3 px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 text-xs">
                    <button
                      type="button"
                      onClick={() => replyTo(emailItem)}
                      className="text-teal-700 dark:text-teal-400 hover:underline font-medium"
                    >
                      ↩ Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => forwardOne(emailItem)}
                      className="text-gray-600 dark:text-gray-300 hover:underline"
                    >
                      ➤ Forward
                    </button>
                    <button
                      type="button"
                      onClick={() => forwardThread(emailItem)}
                      className="text-gray-600 dark:text-gray-300 hover:underline"
                    >
                      ➤ Forward thread
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        }

        // Call — compact card with inline player, right-justified like outbound texts.
        return (
          <div key={item.id} className="flex items-start gap-2 flex-row-reverse">
            <ActorAvatar actor={item.actor} />
            <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ChannelBadge kind="call" />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Call</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {item.payload.status}
                </span>
                {item.payload.duration != null && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {fmtDuration(item.payload.duration)}
                  </span>
                )}
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                  {format(new Date(item.at), 'MMM d, h:mm a')}
                </span>
              </div>
              {item.payload.recordingUrl ? (
                <audio controls preload="none" src={recordingSrc(item.payload.recordingUrl)} className="w-full h-8" />
              ) : (
                <div className="text-[11px] text-gray-400 dark:text-gray-500">No recording</div>
              )}
            </div>
          </div>
        );
      })}

      <LightboxOverlay
        photos={galleryPhotos}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />
    </div>
  );
}
