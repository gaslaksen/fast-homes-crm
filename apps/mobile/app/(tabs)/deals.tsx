import { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePipeline, type PipelineLead } from '@/features/dashboard/dashboard';
import { bandStyle, fullName, statusLabel } from '@/features/leads/leads';
import { Chip } from '@/components/ui';
import { ChevronRight } from '@/components/icons';
import { moneyShort } from '@/lib/format';
import { colors } from '@/theme';

const STAGE_ORDER = [
  'NEW',
  'ATTEMPTING_CONTACT',
  'QUALIFYING',
  'QUALIFIED',
  'OFFER_SENT',
  'NEGOTIATING',
  'UNDER_CONTRACT',
  'CLOSING',
  'ACQUIRED',
  'SOLD',
  'NURTURE',
];

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.filter, active && styles.filterActive]}
      onPress={onPress}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>
        {label} {count}
      </Text>
    </TouchableOpacity>
  );
}

function DealRow({ lead, onPress }: { lead: PipelineLead; onPress: () => void }) {
  const band = bandStyle(lead.scoreBand);
  const addr = [lead.propertyAddress, lead.propertyCity].filter(Boolean).join(', ');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={1}>
          {fullName(lead)}
        </Text>
        <Text style={styles.addr} numberOfLines={1}>
          {addr}
        </Text>
        <View style={styles.rowChips}>
          <Chip label={statusLabel(lead.status)} color={colors.textSecondary} soft={colors.bubbleIn} />
          <Chip label={band.label} color={band.color} soft={band.soft} />
        </View>
      </View>
      <View style={styles.rowRight}>
        {lead.arv != null ? <Text style={styles.arv}>{moneyShort(lead.arv)}</Text> : null}
        <ChevronRight size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

export default function DealsScreen() {
  const router = useRouter();
  const { data: byStage, isLoading, isRefetching, refetch } = usePipeline();
  const [filter, setFilter] = useState<string>('all');

  const all: PipelineLead[] = byStage ? (Object.values(byStage) as PipelineLead[][]).flat() : [];
  const present = byStage ? Object.keys(byStage).filter((s) => byStage[s].length) : [];
  const ordered = [
    ...STAGE_ORDER.filter((s) => present.includes(s)),
    ...present.filter((s) => !STAGE_ORDER.includes(s)),
  ];
  const totalArv = all.reduce((sum: number, l: PipelineLead) => sum + (l.arv ?? 0), 0);
  const list = (filter === 'all' ? all : (byStage?.[filter] ?? []))
    .slice()
    .sort((a: PipelineLead, b: PipelineLead) => (b.arv ?? 0) - (a.arv ?? 0));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={list}
        keyExtractor={(l) => l.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        ListHeaderComponent={
          <View>
            <View style={styles.summary}>
              <View>
                <Text style={styles.summaryValue}>{all.length}</Text>
                <Text style={styles.summaryLabel}>Active deals</Text>
              </View>
              <View style={styles.summaryRight}>
                <Text style={styles.summaryValue}>{moneyShort(totalArv)}</Text>
                <Text style={styles.summaryLabel}>Pipeline ARV</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              <FilterChip label="All" count={all.length} active={filter === 'all'} onPress={() => setFilter('all')} />
              {ordered.map((s) => (
                <FilterChip
                  key={s}
                  label={statusLabel(s)}
                  count={byStage?.[s].length ?? 0}
                  active={filter === s}
                  onPress={() => setFilter(s)}
                />
              ))}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => (
          <DealRow
            lead={item}
            onPress={() => router.push({ pathname: '/lead/detail/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? 'Loading deals…' : 'No deals in this stage.'}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 24 },

  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summaryRight: { alignItems: 'flex-end' },
  summaryValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  summaryLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  filters: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  filter: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextActive: { color: '#fff' },

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
  rowChips: { flexDirection: 'row', gap: 6, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  arv: { fontSize: 15, fontWeight: '700', color: colors.primary },

  empty: { padding: 28, fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
