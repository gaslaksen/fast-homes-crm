import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';
import { RecordingPlayer } from '@/features/calls/RecordingPlayer';
import type { TimelineItem } from './timeline';

function durationLabel(secs: number | null): string {
  if (!secs) return '';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

/** Renders one item of the merged conversation timeline. */
export function TimelineRow({ item }: { item: TimelineItem }) {
  const outbound = item.direction === 'OUTBOUND';

  if (item.kind === 'sms') {
    const media = item.payload.media ?? [];
    return (
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
    );
  }

  if (item.kind === 'call') {
    const { recordingUrl, duration, status } = item.payload;
    const dur = durationLabel(duration);
    return (
      <View style={[styles.callCard, outbound ? styles.alignRight : styles.alignLeft]}>
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
    );
  }

  if (item.kind === 'email') {
    return (
      <View style={[styles.callCard, outbound ? styles.alignRight : styles.alignLeft]}>
        <Text style={styles.callTitle}>Email</Text>
        <Text style={styles.emailSubject}>{item.payload.subject || '(no subject)'}</Text>
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

  // event
  return (
    <View style={styles.eventWrap}>
      <Text style={styles.eventText}>{item.payload.description || item.payload.type}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  media: { width: 210, height: 210, borderRadius: 12, backgroundColor: '#0000000d' },
  mediaSpaced: { marginBottom: 6 },
  inbound: { alignSelf: 'flex-start', backgroundColor: colors.bubbleIn },
  outbound: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  inboundText: { color: colors.text, fontSize: 15 },
  outboundText: { color: '#fff', fontSize: 15 },

  callCard: {
    maxWidth: '85%',
    backgroundColor: colors.primaryTint,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alignLeft: { alignSelf: 'flex-start' },
  alignRight: { alignSelf: 'flex-end' },
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

  eventWrap: { alignSelf: 'center', paddingVertical: 2 },
  eventText: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});
