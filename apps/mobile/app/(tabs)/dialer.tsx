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
import { useRecentCalls, leadName, type RecentCall } from '@/features/calls/hooks';
import { useLeadSearch, fullName } from '@/features/leads/leads';
import { SearchIcon } from '@/components/icons';
import { colors } from '@/theme';

function otherParty(c: RecentCall): { name: string; number: string } {
  const number = c.toNumber || c.lead?.sellerPhone || c.fromNumber || '';
  const name = c.lead ? leadName(c.lead) : number || 'Unknown';
  return { name, number };
}

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DialerScreen() {
  const { startCall } = useCall();
  const { data: recents, isRefetching, refetch } = useRecentCalls();
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
          placeholderTextColor="#9CA3AF"
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

      <View style={styles.searchBar}>
        <SearchIcon size={18} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search a contact to call"
          placeholderTextColor="#9CA3AF"
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
              onPress={() => item.sellerPhone && startCall(item.sellerPhone, fullName(item))}
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
        <FlatList
          data={recents ?? []}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
          ListHeaderComponent={<Text style={styles.section}>Recent calls</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No recent calls.</Text>}
          renderItem={({ item }) => {
            const { name, number: num } = otherParty(item);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => num && startCall(num, name)}
                disabled={!num}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowName}>{name}</Text>
                  <Text style={styles.rowMeta}>
                    {num}
                    {item.disposition ? ` · ${item.disposition}` : ''}
                  </Text>
                </View>
                <Text style={styles.rowWhen}>{when(item.createdAt)}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
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
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 16, color: '#0F172A' },
  clear: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  callLink: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  input: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
    color: '#0F172A',
  },
  callBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  callBtnDisabled: { opacity: 0.4 },
  callBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  section: {
    fontSize: 13,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  empty: { color: '#6B7280', textAlign: 'center', padding: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  rowBody: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: '#0F172A' },
  rowMeta: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  rowWhen: { fontSize: 13, color: '#9CA3AF' },
});
