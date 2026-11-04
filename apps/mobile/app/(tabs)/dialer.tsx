import { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCall } from '@/features/calls/CallContext';
import { CallerIdPicker } from '@/features/calls/CallerIdPicker';
import {
  useRecentCalls,
  useVoicemails,
  leadName,
  prettyPhone,
  type RecentCall,
} from '@/features/calls/hooks';
import { RecordingPlayer } from '@/features/calls/RecordingPlayer';
import { useLeadSearch, fullName } from '@/features/leads/leads';
import { SearchIcon } from '@/components/icons';
import { useThemed, type Colors } from '@/theme';

/**
 * Who was on the other end. An inbound call's other end is the caller, not
 * our own line, and a relative on a surplus case is named rather than the
 * claimant the call is filed under.
 */
function otherParty(c: RecentCall): { name: string; number: string; callName: string } {
  const inbound = c.direction ? c.direction === 'INBOUND' : String(c.type || '').includes('inbound');
  const number = c.number || (inbound ? c.fromNumber : c.toNumber) || c.lead?.sellerPhone || '';
  const lead = c.lead ? leadName(c.lead) : '';
  const name = c.displayName || lead || prettyPhone(number) || 'Unknown';
  return { name, number, callName: c.personName || lead };
}

/** "Missed call", "Incoming · 2:25", "No Answer", "Outgoing · 1:01". */
function describe(c: RecentCall): string {
  const inbound = c.direction === 'INBOUND';
  const length = c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}` : '';
  let what: string;
  if (!inbound) what = c.disposition || 'Outgoing';
  else if (c.callResult === 'missed') return 'Missed call';
  else if (c.callResult === 'voicemail') what = 'Voicemail';
  else if (c.callResult === 'ringing') return 'Ringing';
  else what = c.disposition || 'Incoming';
  return [what, length].filter(Boolean).join(' · ');
}

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Tab = 'recents' | 'voicemail';

export default function DialerScreen() {
  const { colors, styles } = useThemed(makeStyles);
  const { startCall } = useCall();
  const [tab, setTab] = useState<Tab>('recents');
  const { data: recents, isRefetching, refetch } = useRecentCalls();
  const voicemails = useVoicemails(tab === 'voicemail');
  const [number, setNumber] = useState('');
  const [contact, setContact] = useState('');
  const { data: leads } = useLeadSearch({ search: contact, limit: 25 });
  const searching = !!contact.trim();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.dialRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter a phone number"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={number}
          onChangeText={setNumber}
        />
        <TouchableOpacity
          style={[styles.callBtn, !number.trim() && styles.callBtnDisabled]}
          disabled={!number.trim()}
          onPress={() => startCall(number.trim())}
        >
          <Text style={styles.callBtnText}>Call</Text>
        </TouchableOpacity>
      </View>

      <CallerIdPicker compact />

      <View style={styles.searchBar}>
        <SearchIcon size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search a contact to call"
          placeholderTextColor={colors.textMuted}
          value={contact}
          onChangeText={setContact}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {contact ? (
          <TouchableOpacity onPress={() => setContact('')} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {searching ? (
        <FlatList
          data={leads ?? []}
          keyExtractor={(l) => l.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>No matching contacts.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() =>
                item.sellerPhone &&
                startCall(item.sellerPhone, fullName(item), { id: item.id, source: item.source ?? undefined })
              }
              disabled={!item.sellerPhone}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowName}>{fullName(item)}</Text>
                <Text style={styles.rowMeta}>
                  {item.sellerPhone || 'No number'}
                  {item.propertyCity ? ` · ${item.propertyCity}` : ''}
                </Text>
              </View>
              <Text style={styles.callLink}>Call</Text>
            </TouchableOpacity>
          )}
        />
      ) : (
        <>
          <View style={styles.tabs}>
            {(['recents', 'voicemail'] as Tab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, tab === t && styles.tabActive]}
                onPress={() => setTab(t)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'recents' ? 'Recents' : 'Voicemail'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'recents' ? (
            <FlatList
              data={recents ?? []}
              keyExtractor={(c) => c.id}
              refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
              ListEmptyComponent={<Text style={styles.empty}>No recent calls.</Text>}
              renderItem={({ item }) => {
                const { name, number: num, callName } = otherParty(item);
                const missed = item.callResult === 'missed';
                const inbound = item.direction === 'INBOUND';
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => num && startCall(num, callName || name, item.lead ? { id: item.lead.id } : undefined)}
                    disabled={!num}
                  >
                    <Text style={[styles.arrow, missed && { color: colors.danger }]}>
                      {item.direction ? (inbound ? '↙' : '↗') : ''}
                    </Text>
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowName, missed && { color: colors.danger }]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {prettyPhone(num)}
                        {` · ${describe(item)}`}
                      </Text>
                    </View>
                    <Text style={styles.rowWhen}>{when(item.createdAt)}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <FlatList
              data={voicemails.data ?? []}
              keyExtractor={(v) => v.id}
              refreshControl={
                <RefreshControl refreshing={voicemails.isRefetching} onRefresh={() => voicemails.refetch()} />
              }
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {voicemails.isLoading
                    ? 'Loading…'
                    : voicemails.error
                      ? 'Could not load voicemails.'
                      : 'No voicemails. When a caller leaves a message on the greeting, it shows up here.'}
                </Text>
              }
              renderItem={({ item }) => {
                const name = item.displayName || prettyPhone(item.fromNumber) || 'Unknown caller';
                const callName =
                  item.heir?.name || (item.lead ? leadName(item.lead) : '') || prettyPhone(item.fromNumber);
                return (
                  <View style={styles.vm}>
                    <View style={styles.vmTop}>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {name}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {item.displayName ? `${prettyPhone(item.fromNumber)} · ` : ''}
                          {when(item.createdAt)}
                          {!item.lead ? ' · not on file' : ''}
                        </Text>
                      </View>
                      {item.fromNumber ? (
                        <TouchableOpacity
                          onPress={() =>
                            startCall(item.fromNumber!, callName, item.lead ? { id: item.lead.id } : undefined)
                          }
                          hitSlop={8}
                        >
                          <Text style={styles.callLink}>Call back</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {item.transcript ? <Text style={styles.vmText}>{item.transcript}</Text> : null}
                    {item.recordingUrl ? (
                      <RecordingPlayer url={item.recordingUrl} durationSec={item.duration} />
                    ) : null}
                  </View>
                );
              }}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  dialRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bubbleIn,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text },
  clear: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  callLink: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  input: {
    flex: 1,
    backgroundColor: colors.bubbleIn,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  callBtn: {
    backgroundColor: colors.callAccept,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  callBtnDisabled: { opacity: 0.4 },
  callBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  section: {
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  empty: { color: colors.textSecondary, textAlign: 'center', padding: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBody: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  rowWhen: { fontSize: 13, color: colors.textMuted, marginLeft: 8 },
  arrow: { width: 20, fontSize: 14, color: colors.textMuted },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.primaryDark },
  vm: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 6,
  },
  vmTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vmText: { fontSize: 14, color: colors.text, lineHeight: 19 },
});
