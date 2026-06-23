import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth';
import { sendTestPush } from '@/features/push/usePushRegistration';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>
          {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email}
        </Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <TouchableOpacity
        style={styles.action}
        onPress={async () => {
          try {
            const r = await sendTestPush();
            Alert.alert(
              r.sent ? 'Sent' : 'Not sent',
              `Server configured for push: ${r.configured ? 'yes' : 'no'}\n` +
                `Registered devices: ${r.devices}\n\n` +
                (r.sent
                  ? 'Watch for the notification to arrive.'
                  : !r.configured
                    ? 'The API is missing its APNs credentials.'
                    : 'This device is not registered — check notification permission, then reopen the app.'),
            );
          } catch {
            Alert.alert('Error', 'Could not reach the API to send a test notification.');
          }
        }}
      >
        <Text style={styles.actionText}>Send test notification</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.action, styles.signOut]}
        onPress={() =>
          Alert.alert('Sign out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
          ])
        }
      >
        <Text style={[styles.actionText, styles.signOutText]}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  section: { backgroundColor: '#fff', padding: 20, marginTop: 16 },
  label: { fontSize: 13, color: '#94A3B8', textTransform: 'uppercase' },
  value: { fontSize: 18, fontWeight: '600', color: '#0F172A', marginTop: 4 },
  email: { fontSize: 14, color: '#64748B', marginTop: 2 },
  action: {
    backgroundColor: '#fff',
    padding: 18,
    marginTop: 16,
  },
  actionText: { fontSize: 16, color: '#2563EB', fontWeight: '600' },
  signOut: { marginTop: 16 },
  signOutText: { color: '#DC2626' },
});
