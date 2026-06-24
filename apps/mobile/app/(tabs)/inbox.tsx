import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThreads } from '@/features/inbox/hooks';
import type { InboxThread } from '@/features/inbox/types';

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

export default function InboxScreen() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch, error } = useThreads('all');

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Could not load conversations.</Text>
        <TouchableOpacity onPress={() => refetch()}>
          <Text style={styles.retry}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(t) => t.leadId}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>No conversations yet.</Text>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  muted: { color: '#6B7280', fontSize: 15 },
  retry: { color: '#0D9488', fontWeight: '600', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0D9488', fontWeight: '700', fontSize: 18 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: '#0F172A', flex: 1 },
  time: { fontSize: 13, color: '#9CA3AF', marginLeft: 8 },
  preview: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  unreadText: { color: '#0F172A', fontWeight: '700' },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0D9488',
  },
});
