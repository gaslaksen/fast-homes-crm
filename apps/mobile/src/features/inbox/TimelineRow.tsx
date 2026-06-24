import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';
import { RecordingPlayer } from '@/features/calls/RecordingPlayer';
import { clockTime, dayLabel } from '@/lib/format';
import type { TimelineItem } from './timeline';

function durationLabel(secs: number | null): string {
  if (!secs) return '';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

/** Larger centered day heading between message groups. */
export function DateSeparator({ date }: { date: string }) {
  return (
    <View style={styles.dateWrap}>
      <Text style={styles.dateText}>{dayLabel(date)}</Text>
    </View>
  );
}

function Meta({ name, channel, at, right }: { name: string; channel: string; at: string; right?: boolean }) {
  return (
    <Text style={[styles.meta, right && styles.metaRight]} numberOfLines={1}>
      {name} · {channel} · {clockTime(at)}
    </Text>
  );
}

/** Renders one item of the merged conversation timeline. Memoized so typing a
 * draft in the thread doesn't re-render every message row. */
export const TimelineRow = memo(function TimelineRow({ item }: { item: TimelineItem }) {
  const outbound = item.direction === 'OUTBOUND';
  const wrap = [styles.wrap, outbound ? styles.alignRight : styles.alignLeft];

  if (item.kind === 'sms') {
    const media = item.payload.media ?? [];
    return (
      <View style={wrap}>
        <Meta name={item.actor.name} channel="SMS" at={item.at} right={outbound} />
        <View style={[styles.bubble, outbound ? styles.outbound : styles.inbound]}>
          {media.map((m, i) => (
            <Image
              key={i}
              source={{ uri: m.thumbnailUrl || m.url }}
              style={[styles.media, (item.payload.body || i < media.length - 1) && styles.mediaSpaced]}
              resizeMode="cover"
            />
          ))}
          {item.payload.body ? (
            <Text style={outbound ? styles.outboundText : styles.inboundText}>
              {item.payload.body}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (item.kind === 'call') {
    const { recordingUrl, duration, status } = item.payload;
    const dur = durationLabel(duration);
    return (
      <View style={wrap}>
        <Meta name={item.actor.name} channel="Call" at={item.at} right={outbound} />
        <View style={styles.callCard}>
          <Text style={styles.callTitle}>
            {outbound ? 'Outgoing call' : 'Incoming call'}
            {dur ? ` · ${dur}` : ''}
            {status && status !== 'completed' ? ` · ${status}` : ''}
          </Text>
          {recordingUrl ? (
            <RecordingPlayer url={recordingUrl} durationSec={duration} />
          ) : (
            <Text style={styles.muted}>No recording</Text>
          )}
        </View>
      </View>
    );
  }

  if (item.kind === 'email') {
    return (
      <View style={wrap}>
        <Meta name={item.actor.name} channel="Email" at={item.at} right={outbound} />
        <View style={styles.callCard}>
          <Text style={styles.emailSubject}>{item.payload.subject || '(no subject)'}</Text>
        </View>
      </View>
    );
  }

  if (item.kind === 'comment') {
    return (
      <View style={styles.noteCard}>
        <Text style={styles.noteLabel}>Note · {item.actor.name}</Text>
        <Text style={styles.noteBody}>{item.payload.body}</Text>
      </View>
    );
  }

  return (
    <View style={styles.eventWrap}>
      <Text style={styles.eventText}>{item.payload.description || item.payload.type}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { maxWidth: '84%', gap: 3 },
  alignLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  alignRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  meta: { fontSize: 12, color: colors.textMuted, marginHorizontal: 6 },
  metaRight: { textAlign: 'right' },

  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  media: { width: 210, height: 210, borderRadius: 12, backgroundColor: '#0000000d' },
  mediaSpaced: { marginBottom: 6 },
  inbound: { backgroundColor: colors.bubbleIn },
  outbound: { backgroundColor: colors.primary },
  inboundText: { color: colors.text, fontSize: 15 },
  outboundText: { color: '#fff', fontSize: 15 },

  callCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 220,
  },
  callTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  emailSubject: { fontSize: 14, color: colors.textSecondary },
  muted: { fontSize: 12, color: colors.textMuted },

  noteCard: {
    alignSelf: 'stretch',
    backgroundColor: '#FEF9C3',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noteLabel: { fontSize: 11, fontWeight: '700', color: '#854D0E', marginBottom: 2 },
  noteBody: { fontSize: 14, color: '#713F12' },

  dateWrap: { alignSelf: 'center', marginVertical: 8 },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.bubbleIn,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },

  eventWrap: { alignSelf: 'center', paddingVertical: 2, maxWidth: '90%' },
  eventText: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});
