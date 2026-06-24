import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCall } from './callState';

function useDuration(connectedAt: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!connectedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [connectedAt]);
  if (!connectedAt) return '';
  const secs = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Calling…',
  ringing: 'Ringing…',
  connected: '',
  reconnecting: 'Reconnecting…',
  ended: 'Call ended',
};

export function ActiveCallScreen() {
  const { status, muted, peerName, connectedAt, error, toggleMute, hangUp, dismiss } = useCall();
  const duration = useDuration(connectedAt);
  const active = status === 'connected' || status === 'reconnecting';
  const ended = status === 'ended';

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>
            {peerName || 'Call'}
          </Text>
          <Text style={styles.status}>
            {status === 'connected' ? duration : STATUS_LABEL[status] || ''}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.controls}>
          {active && (
            <TouchableOpacity
              style={[styles.smallBtn, muted && styles.smallBtnOn]}
              onPress={toggleMute}
            >
              <Text style={[styles.smallBtnText, muted && styles.smallBtnTextOn]}>
                {muted ? 'Unmute' : 'Mute'}
              </Text>
            </TouchableOpacity>
          )}

          {ended ? (
            <TouchableOpacity style={[styles.endBtn, styles.dismissBtn]} onPress={dismiss}>
              <Text style={styles.endText}>Close</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.endBtn} onPress={hangUp}>
              <Text style={styles.endText}>End call</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'space-between',
    paddingVertical: 80,
  },
  header: { alignItems: 'center', paddingHorizontal: 24 },
  name: { color: '#fff', fontSize: 30, fontWeight: '600', textAlign: 'center' },
  status: { color: '#9CA3AF', fontSize: 18, marginTop: 12 },
  error: { color: '#F87171', fontSize: 14, marginTop: 16, textAlign: 'center' },
  controls: { alignItems: 'center', gap: 20 },
  smallBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#4B5563',
  },
  smallBtnOn: { backgroundColor: '#fff', borderColor: '#fff' },
  smallBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  smallBtnTextOn: { color: '#0F172A' },
  endBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 48,
    paddingVertical: 18,
    borderRadius: 32,
    minWidth: 200,
    alignItems: 'center',
  },
  dismissBtn: { backgroundColor: '#374151' },
  endText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
