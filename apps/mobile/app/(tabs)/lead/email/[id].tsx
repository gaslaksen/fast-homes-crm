import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCommunications } from '@/features/inbox/timeline';
import { useSendEmailReply } from '@/features/inbox/hooks';
import { clockTime, dayLabel } from '@/lib/format';
import { useThemed, type Colors } from '@/theme';

/** Full email body as readable text, preserving line breaks from HTML. */
function bodyToText(bodyText?: string | null, bodyHtml?: string | null): string {
  if (bodyText?.trim()) return bodyText.trim();
  if (!bodyHtml) return '';
  return bodyHtml
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function EmailScreen() {
  const { colors, styles } = useThemed(makeStyles);
  const { id, leadId } = useLocalSearchParams<{ id: string; leadId: string }>();
  const emailId = String(id);
  const lead = String(leadId);
  const { data, isLoading } = useCommunications(lead);
  const reply = useSendEmailReply(lead);
  const [draft, setDraft] = useState('');

  const item = data?.timeline.find((t) => t.kind === 'email' && t.id === `email_${emailId}`);
  const email = item && item.kind === 'email' ? item.payload : null;

  async function onSend() {
    const body = draft.trim();
    if (!body || reply.isPending) return;
    const base = email?.subject || '';
    const subject = /^re:/i.test(base) ? base : `Re: ${base || '(no subject)'}`;
    try {
      await reply.mutateAsync({ subject, body, inReplyToEmailId: emailId });
      setDraft('');
      Alert.alert('Sent', 'Your email reply was sent.');
    } catch {
      Alert.alert('Error', 'Could not send the email reply.');
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!email) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Email' }} />
        <Text style={styles.muted}>This email could not be found.</Text>
      </View>
    );
  }

  const when = `${dayLabel(item!.at)} · ${clockTime(item!.at)}`;
  const outbound = item!.direction === 'OUTBOUND';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Email' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subject}>{email.subject || '(no subject)'}</Text>
          <View style={styles.metaBox}>
            <Text style={styles.metaLine}>
              <Text style={styles.metaLabel}>{outbound ? 'To: ' : 'From: '}</Text>
              {outbound ? email.toAddress || '—' : email.fromAddress || '—'}
            </Text>
            <Text style={styles.metaWhen}>{when}</Text>
          </View>
          <Text style={styles.body} selectable>
            {bodyToText(email.bodyText, email.bodyHtml) || '(no content)'}
          </Text>
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Write an email reply…"
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || reply.isPending) && styles.sendBtnDisabled]}
            onPress={onSend}
            disabled={!draft.trim() || reply.isPending}
          >
            {reply.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.textSecondary, fontSize: 15 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  subject: { fontSize: 20, fontWeight: '700', color: colors.text },
  metaBox: {
    gap: 3,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  metaLine: { fontSize: 14, color: colors.text },
  metaLabel: { color: colors.textSecondary },
  metaWhen: { fontSize: 13, color: colors.textMuted },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bubbleIn,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
