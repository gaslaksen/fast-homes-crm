import { StyleSheet, Text, View } from 'react-native';

/**
 * Placeholder. The real dialer (Twilio Voice React Native SDK + CallKit) lands
 * in Phases 4-5 of docs/mobile-app-plan.md.
 */
export default function DialerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>📞</Text>
      <Text style={styles.title}>Dialer coming soon</Text>
      <Text style={styles.body}>
        Outbound calling and native incoming-call screens arrive with the Twilio
        Voice integration.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emoji: { fontSize: 48 },
  title: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  body: { fontSize: 15, color: '#64748B', textAlign: 'center' },
});
