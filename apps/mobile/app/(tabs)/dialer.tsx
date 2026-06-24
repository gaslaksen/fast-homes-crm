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

      <Text style={styles.section}>Recent calls</Text>
      <FlatList
        data={recents ?? []}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  dialRow: { flexDirection: 'row', gap: 10, padding: 16, alignItems: 'center' },
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
