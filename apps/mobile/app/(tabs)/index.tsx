import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  useActionQueue,
  useDashboardStats,
  useHotLeads,
  actionMeta,
  type ActionItem,
  type HotLead,
} from '@/features/dashboard/dashboard';
import { bandStyle, fullName } from '@/features/leads/leads';
import { Card, SectionLabel, Chip } from '@/components/ui';
import { ChevronRight } from '@/components/icons';
import { moneyShort } from '@/lib/format';
import { colors } from '@/theme';

function MetricTile({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ item, onPress }: { item: ActionItem; onPress: () => void }) {
  const meta = actionMeta(item.type);
  const addr = [item.lead.propertyAddress, item.lead.propertyCity].filter(Boolean).join(', ');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Chip label={meta.label} color={meta.color} soft={meta.soft} />
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {item.subtitle || addr}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function HotLeadRow({ lead, onPress }: { lead: HotLead; onPress: () => void }) {
  const band = bandStyle(lead.scoreBand);
  const addr = [lead.propertyAddress, lead.propertyCity].filter(Boolean).join(', ');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.hotName} numberOfLines={1}>
          {fullName(lead)}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {addr}
        </Text>
      </View>
      <View style={styles.hotRight}>
        {lead.arv != null ? <Text style={styles.hotArv}>{moneyShort(lead.arv)}</Text> : null}
        <Chip label={band.label} color={band.color} soft={band.soft} />
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const stats = useDashboardStats();
  const actions = useActionQueue(6);
  const hot = useHotLeads(5);

  const refreshing = stats.isRefetching || actions.isRefetching || hot.isRefetching;
  const onRefresh = () => {
    stats.refetch();
    actions.refetch();
    hot.refetch();
  };

  const needAction = stats.data?.needsFollowUp ?? actions.data?.length ?? 0;
  const hotCount = stats.data?.leadsByBand?.HOT ?? hot.data?.length ?? 0;
  const pipeline = stats.data?.pipelineArvTotal ?? 0;

  function openAction(item: ActionItem) {
    const meta = actionMeta(item.type);
    const pathname = meta.toConversation ? '/lead/[id]' : '/lead-detail/[id]';
    router.push({ pathname, params: { id: item.leadId } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.metrics}>
          <MetricTile label="Need action" value={String(needAction)} tint={colors.primary} />
          <MetricTile label="Hot leads" value={String(hotCount)} />
          <MetricTile label="Pipeline" value={moneyShort(pipeline)} />
        </View>

        <SectionLabel>Do next</SectionLabel>
        <Card style={styles.listCard}>
          {actions.isLoading ? (
            <ActivityIndicator style={styles.pad} />
          ) : actions.data?.length ? (
            actions.data.map((it: ActionItem, i: number) => (
              <View key={it.actionKey}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <ActionRow item={it} onPress={() => openAction(it)} />
              </View>
            ))
          ) : (
            <Text style={styles.empty}>You're all caught up. 🎉</Text>
          )}
        </Card>

        <SectionLabel>Hot leads</SectionLabel>
        <Card style={styles.listCard}>
          {hot.isLoading ? (
            <ActivityIndicator style={styles.pad} />
          ) : hot.data?.length ? (
            hot.data.map((l: HotLead, i: number) => (
              <View key={l.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <HotLeadRow
                  lead={l}
                  onPress={() =>
                    router.push({ pathname: '/lead-detail/[id]', params: { id: l.id } })
                  }
                />
              </View>
            ))
          ) : (
            <Text style={styles.empty}>No hot leads right now.</Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16, paddingBottom: 32 },

  metrics: { flexDirection: 'row', gap: 12 },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
  },
  metricValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  metricLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  listCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 13, color: colors.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 14 },

  hotName: { fontSize: 15, fontWeight: '600', color: colors.text },
  hotRight: { alignItems: 'flex-end', gap: 4 },
  hotArv: { fontSize: 14, fontWeight: '700', color: colors.primary },

  pad: { padding: 18 },
  empty: { padding: 18, fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
