import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSurplusList,
  useSurplusStats,
  caseLine,
  queueTone,
  stageTone,
  SURPLUS_QUEUES,
  type SurplusRow,
} from './surplus';
import { Chip } from '@/components/ui';
import { SearchIcon, ChevronRight } from '@/components/icons';
import { moneyShort } from '@/lib/format';
import { useThemed, type Colors } from '@/theme';

const SORT_OPTIONS = [
  { label: 'Next step', sort: 'work' },
  { label: 'Biggest net', sort: 'net' },
  { label: 'Newest notice', sort: 'notice' },
  { label: 'Not tapped first', sort: 'untapped' },
];

/** Filters a caller (the Home stat cards) can open the list on. */
export interface SurplusListFilters {
  queue?: string;
  contact?: string;
  letterDue?: string;
}

function SurplusRowItem({ row, onPress }: { row: SurplusRow; onPress: () => void }) {
  const { colors, styles } = useThemed(makeStyles);
  const q = queueTone(row.queue);
  const st = stageTone(row.stage);
  const where = caseLine(row) || [row.address, row.city].filter(Boolean).join(', ');
  const showStage = row.stage && row.stage !== 'New';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={[styles.name, row.isDeceased && styles.deceased]} numberOfLines={1}>
          {row.claimant || 'Unknown claimant'}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {where}
        </Text>
        <View style={styles.chips}>
          <Chip label={row.queueLabel} color={q.color} soft={q.soft} />
          {showStage ? <Chip label={row.stage!} color={st.color} soft={st.soft} /> : null}
          {row.isDeceased ? <Chip label="Estate" color="#6D28D9" soft="#EDE9FE" /> : null}
          {row.contactStatus !== 'not_tapped' ? <Chip label="Tapped" color="#047857" soft="#D1FAE5" /> : null}
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.net}>{moneyShort(row.netToClaimant)}</Text>
        <Text style={styles.netLabel}>net</Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

/**
 * The surplus work list, ranked the way the web board's Next step column is:
 * who can be called right now first, then who needs a trace, heirs or a name
 * search. One row per claimant, since that is who the phone calls.
 */
export function SurplusList({ initial }: { initial: SurplusListFilters }) {
  const { colors, styles } = useThemed(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<string | undefined>(initial.queue || undefined);
  const [contact, setContact] = useState<string | undefined>(initial.contact || undefined);
  const [letterDue, setLetterDue] = useState<string | undefined>(initial.letterDue || undefined);
  const [sortIdx, setSortIdx] = useState(0);

  // Apply a filter passed in from the Home stat cards. Home sends empty
  // strings to clear the ones it does not set.
  useEffect(() => {
    setQueue(initial.queue || undefined);
    setContact(initial.contact || undefined);
    setLetterDue(initial.letterDue || undefined);
  }, [initial.queue, initial.contact, initial.letterDue]);

  // The list endpoint classifies every claim on the server, so wait for a
  // pause in typing rather than asking on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const sortOpt = SORT_OPTIONS[sortIdx];
  const stats = useSurplusStats();
  const list = useSurplusList({
    search: search || undefined,
    queue,
    contact,
    letterDue,
    sort: sortOpt.sort,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const total = list.data?.pages[0]?.total;

  const openSort = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Sort by',
        options: [...SORT_OPTIONS.map((o) => o.label), 'Cancel'],
        cancelButtonIndex: SORT_OPTIONS.length,
      },
      (i) => {
        if (i != null && i < SORT_OPTIONS.length) setSortIdx(i);
      },
    );
  };

  const open = (row: SurplusRow) => {
    // The list row is the same shape the claim screen reads, so it opens
    // instantly and refreshes behind.
    qc.setQueryData(['surplus', row.id], row);
    router.push({ pathname: '/lead/detail/[id]', params: { id: row.id } });
  };

  const counts = stats.data?.queues ?? {};
  const filtered = !!(queue || contact || letterDue || search);

  return (
    <View style={styles.flex}>
      <View style={styles.searchBar}>
        <SearchIcon size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Search claimant, case or address"
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        style={styles.filterScroll}
      >
        <TouchableOpacity
          style={[styles.filterBtn, !queue && styles.filterOn]}
          onPress={() => setQueue(undefined)}
        >
          <Text style={[styles.filterText, !queue && styles.filterTextOn]}>All</Text>
        </TouchableOpacity>
        {SURPLUS_QUEUES.map((o) => {
          const on = queue === o.value;
          const n = counts[o.value];
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.filterBtn, on && styles.filterOn]}
              onPress={() => setQueue(on ? undefined : o.value)}
            >
              <Text style={[styles.filterText, on && styles.filterTextOn]}>
                {o.label}
                {n ? ` ${n}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={openSort} activeOpacity={0.7}>
          <Text style={styles.controlText}>Sort: {sortOpt.label}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, contact && styles.filterOn]}
          onPress={() => setContact(contact ? undefined : 'not_tapped')}
          activeOpacity={0.7}
        >
          <Text style={[styles.controlText, contact && styles.filterTextOn]}>Not tapped</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, letterDue && styles.filterOn]}
          onPress={() => setLetterDue(letterDue ? undefined : 'true')}
          activeOpacity={0.7}
        >
          <Text style={[styles.controlText, letterDue && styles.filterTextOn]}>Letter due</Text>
        </TouchableOpacity>
      </View>

      {total != null ? (
        <Text style={styles.count}>
          {total} claimant{total === 1 ? '' : 's'}
          {filtered ? ' match' : ' to work'}
        </Text>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => {
              list.refetch();
              stats.refetch();
            }}
            tintColor={colors.textMuted}
          />
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <SurplusRowItem row={item} onPress={() => open(item)} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={styles.more} /> : null}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {list.isLoading
              ? 'Loading claims…'
              : list.isError
                ? 'Claims could not be loaded. Pull down to try again.'
                : filtered
                  ? 'No matching claims.'
                  : 'No surplus claims yet.'}
          </Text>
        }
      />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 14,
      marginBottom: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    input: { flex: 1, fontSize: 16, color: colors.text },
    clear: { fontSize: 14, color: colors.primary, fontWeight: '600' },

    filterScroll: { flexGrow: 0 },
    filters: { gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
    filterBtn: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    filterOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    filterTextOn: { color: colors.primaryDark },

    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
    controlBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    controlText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    count: { fontSize: 12, color: colors.textMuted, paddingHorizontal: 16, paddingBottom: 6 },

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
    deceased: { textDecorationLine: 'line-through' },
    sub: { fontSize: 13, color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 },
    rowRight: { alignItems: 'flex-end' },
    net: { fontSize: 16, fontWeight: '700', color: colors.primary },
    netLabel: { fontSize: 11, color: colors.textMuted },
    more: { padding: 16 },
    empty: { padding: 28, fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  });
