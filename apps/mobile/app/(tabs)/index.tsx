import {
  ActivityIndicator,
  Alert,
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
  useInboxCounts,
  actionMeta,
  type ActionItem,
  type HotLead,
} from '@/features/dashboard/dashboard';
import { bandStyle, fullName } from '@/features/leads/leads';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { Card, SectionLabel, Chip } from '@/components/ui';
import {
  BellIcon,
  SettingsIcon,
  ChevronRight,
  ZapIcon,
  TrendingUpIcon,
  MessageIcon,
} from '@/components/icons';
import { moneyShort } from '@/lib/format';
import { colors } from '@/theme';

function StatCard({
  label,
  value,
  Icon,
  iconColor,
  iconBg,
}: {
  label: string;
  value: string;
  Icon: (p: { size?: number; color?: string }) => JSX.Element;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statTop}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
          <Icon size={15} color={iconColor} />
        </View>
      </View>
      <Text style={styles.statValue}>{value}</Text>
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
  const { user } = useAuth();
  const stats = useDashboardStats();
  const actions = useActionQueue(6);
  const hot = useHotLeads(5);
  const counts = useInboxCounts();

  const refreshing =
    stats.isRefetching || actions.isRefetching || hot.isRefetching || counts.isRefetching;
  const onRefresh = () => {
    stats.refetch();
    actions.refetch();
    hot.refetch();
    counts.refetch();
  };

  const needAction = stats.data?.needsFollowUp ?? actions.data?.length ?? 0;
  const hotCount = stats.data?.leadsByBand?.HOT ?? hot.data?.length ?? 0;
  const pipeline = stats.data?.pipelineArvTotal ?? 0;
  const unread = counts.data?.unread ?? 0;

  function openAction(item: ActionItem) {
    const meta = actionMeta(item.type);
    const pathname = meta.toConversation ? '/lead/[id]' : '/lead/detail/[id]';
    router.push({ pathname, params: { id: item.leadId } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <View style={styles.org}>
          <Logo size={34} />
          <View style={styles.orgText}>
            <Text style={styles.orgName} numberOfLines={1}>
              {user?.organization?.name || 'Dealcore'}
            </Text>
            <Text style={styles.orgSub} numberOfLines={1}>
              {[user?.firstName, user?.lastName].filter(Boolean).join(' ')}
            </Text>
          </View>
        </View>
        <View style={styles.topActions}>
          <TouchableOpacity
            hitSlop={8}
            onPress={() => Alert.alert('Notifications', 'In-app notifications are coming soon.')}
          >
            <BellIcon size={23} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={8} onPress={() => router.push('/settings')}>
            <SettingsIcon size={23} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.welcome}>Welcome, {user?.firstName || 'there'}</Text>

        <View style={styles.statGrid}>
          <StatCard label="Need action" value={String(needAction)} Icon={ZapIcon} iconColor="#A16207" iconBg="#FEF9C3" />
          <StatCard label="Pipeline" value={moneyShort(pipeline)} Icon={TrendingUpIcon} iconColor="#15803D" iconBg="#DCFCE7" />
          <StatCard label="Unread" value={String(unread)} Icon={MessageIcon} iconColor={colors.primary} iconBg={colors.primarySoft} />
          <StatCard label="Hot leads" value={String(hotCount)} Icon={ZapIcon} iconColor="#B91C1C" iconBg="#FEE2E2" />
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
                  onPress={() => router.push({ pathname: '/lead/detail/[id]', params: { id: l.id } })}
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

  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  org: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  orgText: { flex: 1 },
  orgName: { fontSize: 16, fontWeight: '700', color: colors.text },
  orgSub: { fontSize: 12, color: colors.textSecondary },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },

  content: { padding: 16, gap: 14, paddingBottom: 32 },
  welcome: { fontSize: 22, fontWeight: '700', color: colors.text },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: {
    width: '47.8%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  statTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 10 },

  listCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
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
