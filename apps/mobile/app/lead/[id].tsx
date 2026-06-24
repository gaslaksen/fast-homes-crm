import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMarkRead, useSendMessage } from '@/features/inbox/hooks';
import { useCommunications, type TimelineItem } from '@/features/inbox/timeline';
import { TimelineRow } from '@/features/inbox/TimelineRow';
import { useLead, leadName } from '@/features/calls/hooks';
import { useCall } from '@/features/calls/CallContext';
import { colors } from '@/theme';

/** Header "Call" button — dials the lead's seller phone via Twilio Voice. */
function ThreadCallButton({ phone, name }: { phone: string | null; name: string }) {
  const { startCall } = useCall();
  if (!phone) return null;
  return (
    <TouchableOpacity onPress={() => startCall(phone, name)} hitSlop={8}>
      <Text style={styles.callBtn}>Call</Text>
    </TouchableOpacity>
  );
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id);
  const router = useRouter();
  const { data, isLoading } = useCommunications(leadId);
  const { data: lead } = useLead(leadId);
  const send = useSendMessage(leadId);
  const markRead = useMarkRead();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<TimelineItem>>(null);

  const timeline = data?.timeline ?? [];

  // Clear the unread flag when the thread is opened.
  useEffect(() => {
    if (leadId) markRead.mutate(leadId);
  }, [leadId]);

  async function onSend() {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    try {
      await send.mutateAsync(body);
    } catch {
      setDraft(body); // restore on failure
    }
  }

  const name = lead ? leadName(lead) : 'Conversation';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <TouchableOpacity
              onPress={() =>
                router.push({ pathname: '/lead-detail/[id]', params: { id: leadId } })
              }
              hitSlop={6}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.headerSub}>Tap for lead details</Text>
            </TouchableOpacity>
          ),
          headerRight: () => (
            <ThreadCallButton phone={lead?.sellerPhone ?? null} name={name} />
          ),
        }}
      />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={90}
        >
          <FlatList
            ref={listRef}
            data={timeline}
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() =>
              requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }))
            }
            onLayout={() =>
              requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }))
            }
            renderItem={({ item }) => <TimelineRow item={item} />}
          />

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Message"
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendDisabled]}
              onPress={onSend}
              disabled={!draft.trim() || send.isPending}
            >
              {send.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendText}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  callBtn: { color: colors.primary, fontSize: 17, fontWeight: '600', paddingHorizontal: 4 },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primary, textAlign: 'center' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 12, gap: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bubbleIn,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '700' },
});
