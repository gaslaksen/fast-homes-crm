import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThreads } from '@/features/inbox/hooks';
import type { InboxFilter, InboxThread } from '@/features/inbox/types';
import { SearchIcon } from '@/components/icons';
import { useThemed, type Colors } from '@/theme';

function fullName(t: InboxThread) {
  return [t.sellerFirstName, t.sellerLastName].filter(Boolean).join(' ') || t.sellerPhone || 'Unknown';
}

function timeAgo(iso: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
];

export default function InboxScreen() {
  const router = useRouter();
  const { colors, styles } = useThemed(makeStyles);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const { data, isLoading, isRefetching, refetch, error } = useThreads(filter, search);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchBar}>
        <SearchIcon size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search conversations"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Text style={styles.retry}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.segments}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.segment, filter === f.key && styles.segmentActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segmentText, filter === f.key && styles.segmentTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data?.items ?? []}
        keyExtractor={(t) => t.leadId}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.textMuted} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            {isLoading ? (
              <ActivityIndicator />
            ) : error ? (
              <>
                <Text style={styles.muted}>Could not load conversations.</Text>
                <TouchableOpacity onPress={() => refetch()}>
                  <Text style={styles.retry}>Retry</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.muted}>
                {search.trim() ? 'No matching conversations.' : filter === 'unread' ? 'No unread conversations.' : 'No conversations yet.'}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push({ pathname: '/lead/[id]', params: { id: item.leadId } })}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.sellerFirstName?.[0] || item.sellerPhone?.[0] || '?').toUpperCase()}
              </Text>
            </View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={[styles.name, item.threadUnread && styles.unreadText]} numberOfLines={1}>
                  {fullName(item)}
                </Text>
                <Text style={styles.time}>{timeAgo(item.lastMessageAt)}</Text>
              </View>
              <Text
                style={[styles.preview, item.threadUnread && styles.unreadText]}
                numberOfLines={1}
              >
                {item.lastMessageDirection === 'OUTBOUND' ? 'You: ' : ''}
                {item.lastMessagePreview || item.propertyAddress || ''}
              </Text>
            </View>
            {item.threadUnread ? <View style={styles.unreadDot} /> : null}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: colors.surface },
  muted: { color: colors.textSecondary, fontSize: 15 },
  retry: { color: colors.primary, fontWeight: '600', marginTop: 8 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text },
  segments: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segmentActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: colors.primaryDark },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primaryDark, fontWeight: '700', fontSize: 18 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 },
  time: { fontSize: 13, color: colors.textMuted, marginLeft: 8 },
  preview: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  unreadText: { color: colors.text, fontWeight: '700' },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
});
