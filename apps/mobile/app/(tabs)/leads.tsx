import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  FlatList,
  RefreshControl,
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
import { useThemed, type Colors } from '@/theme';

const SORT_OPTIONS = [
  { label: 'Best match', sort: 'tier', dir: 'desc' },
  { label: 'Score: high to low', sort: 'score', dir: 'desc' },
  { label: 'Newest', sort: 'created', dir: 'desc' },
  { label: 'ARV: high to low', sort: 'arv', dir: 'desc' },
  { label: 'Recently contacted', sort: 'touched', dir: 'desc' },
  { label: 'Address: A to Z', sort: 'address', dir: 'asc' },
];

const FILTER_OPTIONS: { label: string; band?: string; needsReply?: boolean }[] = [
  { label: 'All leads' },
  { label: 'Hot', band: 'HOT' },
  { label: 'Strike zone', band: 'STRIKE_ZONE' },
  { label: 'Workable', band: 'WORKABLE' },
  { label: 'Warm', band: 'WARM' },
  { label: 'Cool', band: 'COOL' },
  { label: 'Needs reply', needsReply: true },
];

export default function LeadsScreen() {
  const { colors, styles } = useThemed(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ band?: string; needsReply?: string }>();
  const [q, setQ] = useState('');
  const [band, setBand] = useState<string | undefined>(undefined);
  const [needsReply, setNeedsReply] = useState<string | undefined>(undefined);
  const [sortIdx, setSortIdx] = useState(0);

  // Apply a filter passed in from the Home stat cards.
  useEffect(() => {
    setBand(params.band || undefined);
    setNeedsReply(params.needsReply || undefined);
  }, [params.band, params.needsReply]);

  const sortOpt = SORT_OPTIONS[sortIdx];
  const { data: leads, isLoading, isRefetching, refetch } = useLeadSearch({
    search: q,
    scoreBand: band,
    needsReply,
    sort: sortOpt.sort,
    dir: sortOpt.dir,
    limit: 50,
  });

  const filterLabel = band
    ? `${bandStyle(band).label} leads`
    : needsReply
      ? 'Needs reply'
      : null;
  const hasQuery = !!(q.trim() || band || needsReply);

  const openSort = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Sort by', options: [...SORT_OPTIONS.map((o) => o.label), 'Cancel'], cancelButtonIndex: SORT_OPTIONS.length },
      (i) => {
        if (i != null && i < SORT_OPTIONS.length) setSortIdx(i);
      },
    );
  };

  const openFilter = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Filter', options: [...FILTER_OPTIONS.map((o) => o.label), 'Cancel'], cancelButtonIndex: FILTER_OPTIONS.length },
      (i) => {
        if (i == null || i >= FILTER_OPTIONS.length) return;
        const opt = FILTER_OPTIONS[i];
        setBand(opt.band);
        setNeedsReply(opt.needsReply ? 'true' : undefined);
      },
    );
  };

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

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={openSort} activeOpacity={0.7}>
          <Text style={styles.controlText}>Sort: {sortOpt.label}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, filterLabel && styles.controlBtnActive]}
          onPress={openFilter}
          activeOpacity={0.7}
        >
          <Text style={[styles.controlText, filterLabel && styles.controlTextActive]}>
            {filterLabel ?? 'Filter'}
          </Text>
        </TouchableOpacity>
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
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.textMuted} />
        }
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
                  {addr || statusLabel(item.status)}
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
            {isLoading ? 'Loading leads…' : hasQuery ? 'No matching leads.' : 'No leads yet.'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  controls: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  controlBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  controlBtnActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  controlText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  controlTextActive: { color: colors.primaryDark },
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
