import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  useLeadDetail,
  dealHeadline,
  strategyLabel,
  statusLabel,
  fullName,
} from '@/features/leads/leads';
import { bucketStyle } from '@/features/deals/deals';
import {
  useDispositionPlan,
  useDispositionCosts,
  useFinalSale,
  costLabel,
  jvSplitLabel,
  type DispositionCost,
} from '@/features/deals/disposition';
import { Card, SectionLabel, Chip, Stat } from '@/components/ui';
import { ChevronRight } from '@/components/icons';
import { money } from '@/lib/format';
import { colors } from '@/theme';

function dateShort(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

export default function DispositionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id);
  const router = useRouter();
  const { data: lead, isLoading } = useLeadDetail(leadId);
  const plan = useDispositionPlan(leadId);
  const costs = useDispositionCosts(leadId);
  const sale = useFinalSale(leadId);

  if (isLoading || !lead) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const name = fullName(lead);
  const bucket = bucketStyle(lead.profitBucket);
  const deal = dealHeadline(lead.currentDealNumbers);
  const profit = lead.realizedProfit ?? deal?.profit ?? null;
  const address = [lead.propertyAddress, [lead.propertyCity, lead.propertyState].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ');
  const exit = plan.data?.exitStrategy ?? lead.currentDealNumbers?.strategy ?? null;
  const split = jvSplitLabel(plan.data?.jvSplitMode, plan.data?.jvSplitPercent);
  const costList: DispositionCost[] = costs.data ?? [];
  const costTotal = costList.reduce((s: number, c: DispositionCost) => s + (c.amount ?? 0), 0);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name}>{name}</Text>
          {address ? <Text style={styles.address}>{address}</Text> : null}
          <View style={styles.chipRow}>
            <Chip label={statusLabel(lead.status)} color={colors.textSecondary} soft={colors.bubbleIn} />
            {lead.profitBucket ? <Chip label={bucket.label} color={bucket.color} soft={bucket.soft} /> : null}
          </View>
        </View>

        <TouchableOpacity
          style={styles.contactBtn}
          onPress={() => router.push({ pathname: '/lead/detail/[id]', params: { id: leadId } })}
        >
          <Text style={styles.contactText}>View lead details & contact</Text>
          <ChevronRight size={18} color={colors.primary} />
        </TouchableOpacity>

        <SectionLabel>Profit</SectionLabel>
        <Card style={styles.profitCard}>
          <Text style={styles.profitLabel}>
            {lead.status === 'SOLD' ? 'Realized profit (our share)' : 'Projected profit (our share)'}
          </Text>
          <Text style={[styles.profitValue, { color: profit != null ? bucket.color : colors.textMuted }]}>
            {profit != null ? money(profit) : 'Not set'}
          </Text>
          {split ? <Text style={styles.profitNote}>JV split · {split}</Text> : null}
        </Card>

        <SectionLabel>Exit strategy</SectionLabel>
        <Card>
          <Row label="Strategy" value={exit ? strategyLabel(exit) : 'Not set'} />
          {plan.data?.jvPartner?.name ? <Row label="JV partner" value={plan.data.jvPartner.name} /> : null}
          {split ? <Row label="Split" value={split} /> : null}
          <Row
            label="Target sale price"
            value={plan.data?.targetSalePrice != null ? money(plan.data.targetSalePrice) : money(lead.arv)}
          />
          {plan.data?.targetCloseDate ? (
            <Row label="Target close" value={dateShort(plan.data.targetCloseDate)} />
          ) : null}
        </Card>

        <SectionLabel>Deal math</SectionLabel>
        <Card>
          <View style={styles.statRow}>
            <Stat label="ARV" value={money(lead.arv)} />
            <Stat label="Repairs" value={money(lead.currentRepairEstimate)} />
          </View>
          <View style={[styles.statRow, styles.statRowDivider]}>
            <Stat label="Max offer" value={money(deal?.offer ?? null)} accent />
            <Stat label="Asking" value={money(lead.askingPrice)} />
          </View>
        </Card>

        <SectionLabel>Costs{costList.length ? ` · ${money(costTotal)}` : ''}</SectionLabel>
        <Card>
          {costList.length ? (
            costList.map((c) => (
              <Row key={c.id} label={costLabel(c.category)} value={money(c.amount)} />
            ))
          ) : (
            <Text style={styles.muted}>No costs recorded yet.</Text>
          )}
        </Card>

        <SectionLabel>{sale.data ? 'Sale' : 'Acquisition'}</SectionLabel>
        <Card>
          {sale.data ? (
            <>
              <Row label="Sale price" value={money(sale.data.finalSalePrice)} />
              {sale.data.buyerName ? <Row label="Buyer" value={sale.data.buyerName} /> : null}
              {sale.data.saleClosingCosts != null ? (
                <Row label="Closing costs" value={money(sale.data.saleClosingCosts)} />
              ) : null}
              {sale.data.netProceeds != null ? (
                <Row label="Net proceeds" value={money(sale.data.netProceeds)} />
              ) : null}
              <Row label="Closed" value={dateShort(sale.data.closedAt)} />
            </>
          ) : (
            <>
              <Row label="Acquired" value={dateShort(lead.acquiredDate)} />
              {lead.soldDate ? <Row label="Sold" value={dateShort(lead.soldDate)} /> : null}
              {!lead.acquiredDate && !lead.soldDate ? (
                <Text style={styles.muted}>Not yet acquired.</Text>
              ) : null}
            </>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 16, gap: 14, paddingBottom: 40 },

  header: { gap: 6 },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  address: { fontSize: 14, color: colors.textSecondary },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 4 },

  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  contactText: { fontSize: 15, fontWeight: '600', color: colors.primary },

  profitCard: { backgroundColor: colors.primaryTint, borderColor: colors.primarySoft },
  profitLabel: { fontSize: 13, color: colors.textSecondary },
  profitValue: { fontSize: 30, fontWeight: '800', marginTop: 4 },
  profitNote: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  kvLabel: { fontSize: 14, color: colors.textSecondary },
  kvValue: { fontSize: 14, fontWeight: '500', color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted, paddingVertical: 4 },

  statRow: { flexDirection: 'row', gap: 16 },
  statRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 12,
  },
});
