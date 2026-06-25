import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import { getAuthToken } from '@/lib/api';
import { useThemed, type Colors } from '@/theme';

/** Twilio recording proxy URLs need the bearer as ?token=; CDN URLs play as-is. */
function signedUrl(url: string): string {
  if (!url.includes('/calls/twilio/recording-media/')) return url;
  const token = getAuthToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export function RecordingPlayer({
  url,
  durationSec,
  dark,
}: {
  url: string;
  durationSec?: number | null;
  dark?: boolean;
}) {
  const { colors, styles } = useThemed(makeStyles);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState((durationSec ?? 0) * 1000);

  useEffect(
    () => () => {
      sound?.unloadAsync().catch(() => {});
    },
    [sound],
  );

  async function toggle() {
    try {
      if (!sound) {
        setLoading(true);
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound: s } = await Audio.Sound.createAsync(
          { uri: signedUrl(url) },
          { shouldPlay: true },
          (st) => {
            if (!st.isLoaded) return;
            setPositionMs(st.positionMillis);
            if (st.durationMillis) setDurationMs(st.durationMillis);
            setPlaying(st.isPlaying);
            if (st.didJustFinish) {
              setPlaying(false);
              s.setPositionAsync(0).catch(() => {});
            }
          },
        );
        setSound(s);
        setLoading(false);
      } else if (playing) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch {
      setLoading(false);
    }
  }

  const tint = dark ? '#fff' : colors.primary;
  const track = dark ? 'rgba(255,255,255,0.3)' : colors.border;
  const pct = durationMs ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={toggle} style={[styles.btn, { borderColor: tint }]}>
        {loading ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Text style={[styles.icon, { color: tint }]}>{playing ? '❚❚' : '▶'}</Text>
        )}
      </TouchableOpacity>
      <View style={[styles.bar, { backgroundColor: track }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
      </View>
      <Text style={[styles.time, { color: dark ? 'rgba(255,255,255,0.85)' : colors.textSecondary }]}>
        {fmt(playing || positionMs ? positionMs : durationMs)}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200 },
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 12, fontWeight: '700' },
  bar: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  time: { fontSize: 12, minWidth: 38, textAlign: 'right' },
});
