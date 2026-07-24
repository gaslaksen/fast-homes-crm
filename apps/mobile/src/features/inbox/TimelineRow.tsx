import { memo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemed, type Colors } from '@/theme';
import { RecordingPlayer } from '@/features/calls/RecordingPlayer';
import { ChevronRight } from '@/components/icons';
import { clockTime, dayLabel } from '@/lib/format';
import type { TimelineItem } from './timeline';

/** Plain-text preview from an email body (strips tags if only HTML is present). */
export function emailPreview(bodyText?: string | null, bodyHtml?: string | null): string {
  const raw = bodyText?.trim() || (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, ' ') : '');
  return raw.replace(/\s+/g, ' ').trim();
}

function durationLabel(secs: number | null): string {
  if (!secs) return '';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

/** Larger centered day heading between message groups. */
export function DateSeparator({ date }: { date: string }) {
  const { styles } = useThemed(makeStyles);
  return (
    <View style={styles.dateWrap}>
      <Text style={styles.dateText}>{dayLabel(date)}</Text>
    </View>
  );
}

function Meta({ name, channel, at, right }: { name: string; channel: string; at: string; right?: boolean }) {
  const { styles } = useThemed(makeStyles);
  return (
    <Text style={[styles.meta, right && styles.metaRight]} numberOfLines={1}>
      {name} · {channel} · {clockTime(at)}
    </Text>
  );
}

/** Renders one item of the merged conversation timeline. Memoized so typing a
 * draft in the thread doesn't re-render every message row. */
export const TimelineRow = memo(function TimelineRow({
  item,
  leadId,
}: {
  item: TimelineItem;
  leadId: string;
}) {
  const { colors, styles } = useThemed(makeStyles);
  const router = useRouter();
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
    const preview = emailPreview(item.payload.bodyText, item.payload.bodyHtml);
    const emailId = item.id.replace(/^email_/, '');
    return (
      <View style={wrap}>
        <Meta name={item.actor.name} channel="Email" at={item.at} right={outbound} />
        <TouchableOpacity
          style={styles.emailCard}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: '/lead/email/[id]', params: { id: emailId, leadId } })}
        >
          <View style={styles.emailHead}>
            <Text style={styles.emailSubjectStrong} numberOfLines={1}>
              {item.payload.subject || '(no subject)'}
            </Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </View>
          {preview ? (
            <Text style={styles.emailPreview} numberOfLines={2}>
              {preview}
            </Text>
          ) : null}
          <Text style={styles.emailOpen}>Tap to read & reply</Text>
        </TouchableOpacity>
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

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  emailCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  emailHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  emailSubjectStrong: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  emailPreview: { fontSize: 13, color: colors.textSecondary },
  emailOpen: { fontSize: 12, fontWeight: '600', color: colors.primary, marginTop: 2 },
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
