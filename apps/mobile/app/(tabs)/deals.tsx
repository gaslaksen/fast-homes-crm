import { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  useDeals,
  useDealsSummary,
  bucketStyle,
  BUCKETS,
  type Bucket,
  type DealRow,
} from '@/features/deals/deals';
import { statusLabel, strategyLabel } from '@/features/leads/leads';
import { Chip } from '@/components/ui';
import { ChevronRight } from '@/components/icons';
import { money, moneyShort } from '@/lib/format';
import { colors } from '@/theme';

function SummaryCard({
  bucket,
  sum,
  count,
  active,
  onPress,
}: {
  bucket: (typeof BUCKETS)[number];
  sum: number;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.sumCard, active && { borderColor: bucket.color, borderWidth: 2 }]}
      onPress={onPress}
    >
      <Text style={[styles.sumLabel, { color: bucket.color }]}>{bucket.label}</Text>
      <Text style={styles.sumValue}>{moneyShort(sum)}</Text>
      <Text style={styles.sumCount}>
        {count} deal{count === 1 ? '' : 's'}
      </Text>
    </TouchableOpacity>
  );
}

function DealRowItem({ deal, onPress }: { deal: DealRow; onPress: () => void }) {
  const b = bucketStyle(deal.bucket);
  const addr = [deal.propertyAddress, deal.propertyCity].filter(Boolean).join(', ');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={1}>
          {deal.ownerName}
        </Text>
        <Text style={styles.addr} numberOfLines={1}>
          {addr}
        </Text>
        <View style={styles.rowChips}>
          <Chip label={statusLabel(deal.status)} color={colors.textSecondary} soft={colors.bubbleIn} />
          {deal.exitStrategy ? (
            <Chip label={strategyLabel(deal.exitStrategy)} color={b.color} soft={b.soft} />
          ) : null}
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.profit, { color: deal.ourShareProfit != null ? b.color : colors.textMuted }]}>
          {deal.ourShareProfit != null ? money(deal.ourShareProfit) : '—'}
        </Text>
        <Text style={styles.days}>{deal.daysInStage}d in stage</Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function DealsScreen() {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const summary = useDealsSummary();
  const deals = useDeals({ bucket: bucket ?? undefined, sort: 'profit', dir: 'desc', limit: 100 });

  const refreshing = summary.isRefetching || deals.isRefetching;
  const onRefresh = () => {
    summary.refetch();
    deals.refetch();
  };
  const s = summary.data;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={deals.data?.deals ?? []}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.summaryRow}>
            <SummaryCard
              bucket={BUCKETS[0]}
              sum={s?.potential.sum ?? 0}
              count={s?.potential.count ?? 0}
              active={bucket === 'potential'}
              onPress={() => setBucket(bucket === 'potential' ? null : 'potential')}
            />
            <SummaryCard
              bucket={BUCKETS[1]}
              sum={s?.expected.sum ?? 0}
              count={s?.expected.count ?? 0}
              active={bucket === 'expected'}
              onPress={() => setBucket(bucket === 'expected' ? null : 'expected')}
            />
            <SummaryCard
              bucket={BUCKETS[2]}
              sum={s?.realized.sum ?? 0}
              count={s?.realized.count ?? 0}
              active={bucket === 'realized'}
              onPress={() => setBucket(bucket === 'realized' ? null : 'realized')}
            />
          </View>
        }
        renderItem={({ item }) => (
          <DealRowItem
            deal={item}
            onPress={() => router.push({ pathname: '/lead/detail/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {deals.isLoading
              ? 'Loading deals…'
              : bucket
                ? `No ${bucket} deals.`
                : 'No active deals yet.'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 24 },

  summaryRow: { flexDirection: 'row', gap: 10, padding: 14 },
  sumCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  sumLabel: { fontSize: 12, fontWeight: '700' },
  sumValue: { fontSize: 19, fontWeight: '700', color: colors.text, marginTop: 6 },
  sumCount: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

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
  rowMain: { flex: 1, gap: 4 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  addr: { fontSize: 13, color: colors.textSecondary },
  rowChips: { flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  profit: { fontSize: 15, fontWeight: '700' },
  days: { fontSize: 11, color: colors.textMuted },

  empty: { padding: 28, fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
