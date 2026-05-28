'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import Avatar from '@/components/Avatar';
import type { Actor, TimelineItem } from './types';

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// AI/System get a fixed-color initials chip; users/sellers hash by name.
function ActorAvatar({ actor }: { actor: Actor }) {
  if (actor.type === 'ai') {
    return (
      <span
        title="AI"
        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-white bg-teal-600 flex-shrink-0"
      >
        AI
      </span>
    );
  }
  if (actor.type === 'system') {
    return (
      <span
        title="System"
        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-white bg-gray-500 flex-shrink-0"
      >
        SYS
      </span>
    );
  }
  return <Avatar name={actor.name} avatarUrl={actor.type === 'user' ? actor.avatarUrl : null} size="sm" />;
}

function MetaLine({ actor, at }: { actor: Actor; at: string }) {
  return (
    <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
      {actor.name} • {format(new Date(at), 'MMM d, h:mm a')}
    </div>
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

export default function CommunicationsTimeline({ items }: { items: TimelineItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return <div className="text-xs text-gray-400 dark:text-gray-500">No communications yet.</div>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const outbound = item.direction === 'OUTBOUND';

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
              <div className="p-3 rounded-lg max-w-[80%] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
                <div className="text-[10px] text-amber-700 dark:text-amber-400 mb-1 uppercase tracking-wide flex items-center gap-1">
                  👁 Internal comment • {item.actor.name} • {format(new Date(item.at), 'MMM d, h:mm a')}
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                  {renderWithMentions(item.payload.body)}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            key={item.id}
            className={`flex items-start gap-2 ${outbound ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <ActorAvatar actor={item.actor} />
            <div
              className={`p-3 rounded-lg max-w-[80%] ${
                outbound
                  ? 'bg-primary-50 dark:bg-primary-900/30'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}
            >
              {item.kind === 'sms' && (
                <>
                  <MetaLine actor={item.actor} at={item.at} />
                  <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                    {item.payload.body}
                  </div>
                </>
              )}

              {item.kind === 'email' && (
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  className="text-left w-full"
                >
                  <MetaLine actor={item.actor} at={item.at} />
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    ✉ {item.payload.subject || '(no subject)'}
                  </div>
                  {expandedId === item.id ? (
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
              )}

              {item.kind === 'call' && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      📞 Call
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/20 text-gray-600 dark:text-gray-300">
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
                    <audio controls preload="none" src={item.payload.recordingUrl} className="w-full h-8" />
                  ) : (
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">No recording</div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
