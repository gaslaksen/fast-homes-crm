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
import { CheckIcon } from '@/components/icons';
import { useThemed, useThemeMode, type Colors, type ThemeMode } from '@/theme';

const APPEARANCE: { mode: ThemeMode; label: string; hint: string }[] = [
  { mode: 'system', label: 'System', hint: 'Match your device setting' },
  { mode: 'light', label: 'Light', hint: '' },
  { mode: 'dark', label: 'Dark', hint: '' },
];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { colors, styles } = useThemed(makeStyles);
  const { mode, setMode } = useThemeMode();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>
          {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email}
        </Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <Text style={styles.sectionHeading}>Appearance</Text>
      <View style={styles.group}>
        {APPEARANCE.map((opt, i) => (
          <TouchableOpacity
            key={opt.mode}
            style={[styles.optionRow, i > 0 && styles.optionDivider]}
            onPress={() => setMode(opt.mode)}
            activeOpacity={0.7}
          >
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>{opt.label}</Text>
              {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
            </View>
            {mode === opt.mode ? <CheckIcon size={20} color={colors.primary} /> : null}
          </TouchableOpacity>
        ))}
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

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  section: { backgroundColor: colors.surface, padding: 20, marginTop: 16 },
  label: { fontSize: 13, color: colors.textMuted, textTransform: 'uppercase' },
  value: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 4 },
  email: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },

  sectionHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  group: { backgroundColor: colors.surface },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  optionText: { gap: 2 },
  optionLabel: { fontSize: 16, color: colors.text },
  optionHint: { fontSize: 13, color: colors.textMuted },

  action: { backgroundColor: colors.surface, padding: 18, marginTop: 16 },
  actionText: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  signOut: { marginTop: 16 },
  signOutText: { color: colors.danger },
});
