import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useLeadSearch, bandStyle, fullName, statusLabel, type LeadListItem } from '@/features/leads/leads';
import { Chip } from '@/components/ui';
import { SearchIcon, ChevronRight } from '@/components/icons';
import { colors } from '@/theme';

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ band?: string; needsReply?: string }>();
  const [q, setQ] = useState('');
  const [band, setBand] = useState<string | undefined>(undefined);
  const [needsReply, setNeedsReply] = useState<string | undefined>(undefined);

  // Apply a filter passed in from the Home stat cards.
  useEffect(() => {
    setBand(params.band || undefined);
    setNeedsReply(params.needsReply || undefined);
  }, [params.band, params.needsReply]);

  const { data: leads, isLoading } = useLeadSearch({
    search: q,
    scoreBand: band,
    needsReply,
    limit: 40,
  });

  const filterLabel = band
    ? `${bandStyle(band).label} leads`
    : needsReply
      ? 'Needs reply'
      : null;
  const hasQuery = !!(q.trim() || band || needsReply);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchBar}>
        <SearchIcon size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Search leads by name or address"
          placeholderTextColor={colors.textMuted}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {filterLabel ? (
        <View style={styles.filterRow}>
          <Chip label={filterLabel} color={colors.primary} soft={colors.primarySoft} />
          <TouchableOpacity
            onPress={() => {
              setBand(undefined);
              setNeedsReply(undefined);
            }}
            hitSlop={8}
          >
            <Text style={styles.clear}>Clear filter</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={leads ?? []}
        keyExtractor={(l) => l.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }: { item: LeadListItem }) => {
          const b = bandStyle(item.scoreBand);
          const addr = [item.propertyAddress, item.propertyCity].filter(Boolean).join(', ');
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push({ pathname: '/lead/detail/[id]', params: { id: item.id } })}
            >
              <View style={styles.rowMain}>
                <Text style={styles.name} numberOfLines={1}>
                  {fullName(item)}
                </Text>
                <Text style={styles.addr} numberOfLines={1}>
                  {addr}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Chip label={b.label} color={b.color} soft={b.soft} />
                <ChevronRight size={16} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading
              ? 'Searching…'
              : hasQuery
                ? 'No matching leads.'
                : 'Search across all your leads by name or address.'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  input: { flex: 1, fontSize: 16, color: colors.text },
  clear: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  addr: { fontSize: 13, color: colors.textSecondary },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { padding: 28, fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
