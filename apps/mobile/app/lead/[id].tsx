import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
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
import { useMarkRead, useMessages, useSendMessage } from '@/features/inbox/hooks';
import type { Message } from '@/features/inbox/types';
import { useLead, leadName } from '@/features/calls/hooks';
import { useCall } from '@/features/calls/CallContext';

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
  const { data: messages, isLoading } = useMessages(leadId);
  const { data: lead } = useLead(leadId);
  const send = useSendMessage(leadId);
  const markRead = useMarkRead();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Message>>(null);

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

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const name = lead ? leadName(lead) : 'Conversation';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <ThreadCallButton phone={lead?.sellerPhone ?? null} name={name} />
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const outbound = item.direction === 'OUTBOUND';
            return (
              <View
                style={[styles.bubble, outbound ? styles.outbound : styles.inbound]}
              >
                <Text style={outbound ? styles.outboundText : styles.inboundText}>
                  {item.body}
                </Text>
              </View>
            );
          }}
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor="#94A3B8"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  callBtn: { color: '#2563EB', fontSize: 17, fontWeight: '600', paddingHorizontal: 4 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 12, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  inbound: { alignSelf: 'flex-start', backgroundColor: '#F1F5F9' },
  outbound: { alignSelf: 'flex-end', backgroundColor: '#2563EB' },
  inboundText: { color: '#0F172A', fontSize: 15 },
  outboundText: { color: '#fff', fontSize: 15 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
  },
  input: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    color: '#0F172A',
  },
  sendBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '700' },
});
