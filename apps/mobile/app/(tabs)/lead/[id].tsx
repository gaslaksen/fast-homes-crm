import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGenerateDraft, useMarkRead, useSendMessage } from '@/features/inbox/hooks';
import { useCommunications, type TimelineItem } from '@/features/inbox/timeline';
import { TimelineRow, DateSeparator } from '@/features/inbox/TimelineRow';
import { useLeadDetail, useUpdateLead, fullName } from '@/features/leads/leads';
import { useCall } from '@/features/calls/CallContext';
import { SparkleIcon, PhoneIcon, MessageIcon, MailIcon } from '@/components/icons';
import { sameDay } from '@/lib/format';
import { colors } from '@/theme';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** GHL-style header avatar with a tiny last-channel badge. */
function HeaderAvatar({ name, kind }: { name: string; kind?: string }) {
  const Badge = kind === 'call' ? PhoneIcon : kind === 'email' ? MailIcon : MessageIcon;
  return (
    <View>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initialsOf(name)}</Text>
      </View>
      <View style={styles.badge}>
        <Badge size={10} color="#fff" />
      </View>
    </View>
  );
}

function ThreadCallButton({ phone, name }: { phone: string | null; name: string }) {
  const { startCall } = useCall();
  if (!phone) return null;
  return (
    <TouchableOpacity onPress={() => startCall(phone, name)} hitSlop={10} style={styles.headerIcon}>
      <PhoneIcon size={22} color={colors.primary} />
    </TouchableOpacity>
  );
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id);
  const router = useRouter();
  const { data, isLoading } = useCommunications(leadId);
  const { data: lead } = useLeadDetail(leadId);
  const update = useUpdateLead(leadId);
  const send = useSendMessage(leadId);
  const draftMut = useGenerateDraft(leadId);
  const markRead = useMarkRead();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<TimelineItem>>(null);

  const timeline = data?.timeline ?? [];
  const name = lead ? fullName(lead) : 'Conversation';

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
      setDraft(body);
    }
  }

  async function onSuggest() {
    if (draftMut.isPending) return;
    try {
      const msg = await draftMut.mutateAsync(undefined);
      if (msg) setDraft(msg);
    } catch {
      // best-effort
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <TouchableOpacity
              style={styles.headerWrap}
              onPress={() => router.push({ pathname: '/lead/detail/[id]', params: { id: leadId } })}
              hitSlop={6}
            >
              <HeaderAvatar name={name} kind={timeline[timeline.length - 1]?.kind} />
              <View style={styles.headerTextCol}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.headerSub}>Tap for lead details</Text>
              </View>
            </TouchableOpacity>
          ),
          headerRight: () => <ThreadCallButton phone={lead?.sellerPhone ?? null} name={name} />,
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
            renderItem={({ item, index }) => {
              const prev = index > 0 ? timeline[index - 1] : null;
              const showDate = !prev || !sameDay(prev.at, item.at);
              return (
                <>
                  {showDate ? <DateSeparator date={item.at} /> : null}
                  <TimelineRow item={item} />
                </>
              );
            }}
          />

          {lead ? (
            <View style={styles.aiBar}>
              <SparkleIcon size={15} color={lead.autoRespond ? colors.primary : colors.textMuted} />
              <Text style={styles.aiText}>
                AI auto-reply {lead.autoRespond ? 'on' : 'off'}
              </Text>
              <View style={styles.spacer} />
              <Switch
                value={!!lead.autoRespond}
                onValueChange={(v) => update.mutate({ autoRespond: v })}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          ) : null}

          <View style={styles.composer}>
            <TouchableOpacity
              style={styles.aiBtn}
              onPress={onSuggest}
              disabled={draftMut.isPending}
              hitSlop={6}
            >
              {draftMut.isPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <SparkleIcon size={24} color={colors.primary} />
              )}
            </TouchableOpacity>
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
  headerIcon: { paddingHorizontal: 4 },
  headerWrap: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  headerTextCol: { justifyContent: 'center' },
  headerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  headerSub: { fontSize: 11, color: colors.textSecondary },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 12, gap: 8 },

  aiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  aiText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  spacer: { flex: 1 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  aiBtn: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
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
