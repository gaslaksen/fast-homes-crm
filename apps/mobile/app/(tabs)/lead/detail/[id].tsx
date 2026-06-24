import {
  ActionSheetIOS,
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  useLeadDetail,
  useUpdateLead,
  dealHeadline,
  strategyLabel,
  bandStyle,
  statusLabel,
  fullName,
} from '@/features/leads/leads';
import { useCall } from '@/features/calls/CallContext';
import { Card, SectionLabel, Chip, Stat } from '@/components/ui';
import { PhoneIcon, MessageIcon, MailIcon, ZapIcon, PencilIcon } from '@/components/icons';
import { money, timelineLabel } from '@/lib/format';
import { colors } from '@/theme';

const STATUS_OPTIONS = [
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
  'DEAD',
];

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.action, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {icon}
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function CampRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.campRow}>
      <Text style={styles.campLabel}>{label}</Text>
      <Text style={[styles.campValue, !value && styles.campMissing]} numberOfLines={2}>
        {value || 'Not captured yet'}
      </Text>
    </View>
  );
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id);
  const router = useRouter();
  const { data: lead, isLoading } = useLeadDetail(leadId);
  const update = useUpdateLead(leadId);
  const { startCall } = useCall();

  if (isLoading || !lead) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const name = fullName(lead);
  const band = bandStyle(lead.scoreBand);
  const deal = dealHeadline(lead.currentDealNumbers);
  const hasDeal = !!deal && (deal.offer != null || deal.profit != null);
  const address = [
    lead.propertyAddress,
    [lead.propertyCity, lead.propertyState].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  function changeStatus() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Set lead status',
        options: [...STATUS_OPTIONS.map(statusLabel), 'Cancel'],
        cancelButtonIndex: STATUS_OPTIONS.length,
      },
      (i) => {
        if (i != null && i < STATUS_OPTIONS.length) {
          update.mutate({ status: STATUS_OPTIONS[i] });
        }
      },
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/lead/edit/[id]', params: { id: leadId } })}
              hitSlop={10}
              style={styles.editBtn}
            >
              <PencilIcon size={20} color={colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {lead.primaryPhoto ? (
          <Image source={{ uri: lead.primaryPhoto }} style={styles.hero} resizeMode="cover" />
        ) : null}

        <View style={styles.headerBlock}>
          <Text style={styles.name}>{name}</Text>
          {address ? <Text style={styles.address}>{address}</Text> : null}
          <View style={styles.chipRow}>
            <Chip label={band.label} color={band.color} soft={band.soft} />
            <TouchableOpacity onPress={changeStatus} hitSlop={6}>
              <Chip label={statusLabel(lead.status)} color={colors.textSecondary} soft={colors.bubbleIn} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.actions}>
          <ActionButton
            icon={<PhoneIcon size={22} color={colors.primary} />}
            label="Call"
            onPress={() => lead.sellerPhone && startCall(lead.sellerPhone, name)}
            disabled={!lead.sellerPhone}
          />
          <ActionButton
            icon={<MessageIcon size={22} color={colors.primary} />}
            label="Message"
            onPress={() => router.push({ pathname: '/lead/[id]', params: { id: leadId } })}
          />
          <ActionButton
            icon={<MailIcon size={22} color={colors.primary} />}
            label="Email"
            onPress={() => lead.sellerEmail && Linking.openURL(`mailto:${lead.sellerEmail}`)}
            disabled={!lead.sellerEmail}
          />
        </View>

        <SectionLabel>Deal</SectionLabel>
        <Card style={styles.dealCard}>
          <View style={styles.dealHead}>
            <View style={styles.dealStrategy}>
              <ZapIcon size={15} color={colors.primary} />
              <Text style={styles.dealStrategyText}>
                {strategyLabel(lead.currentDealNumbers?.strategy)}
              </Text>
            </View>
            {lead.arvConfidence != null ? (
              <Text style={styles.conf}>{Math.round(lead.arvConfidence)}% confidence</Text>
            ) : null}
          </View>
          {hasDeal || lead.arv != null ? (
            <>
              <View style={styles.dealGrid}>
                <Stat label="ARV" value={money(lead.arv)} />
                <Stat label="Repairs" value={money(lead.currentRepairEstimate)} />
              </View>
              <View style={[styles.dealGrid, styles.dealGridAccent]}>
                <Stat label="Max offer" value={money(deal?.offer ?? null)} accent />
                <Stat label={deal?.profitLabel ?? 'Spread'} value={money(deal?.profit ?? null)} accent />
              </View>
            </>
          ) : (
            <Text style={styles.empty}>
              No deal math yet{lead.askingPrice != null ? ` · asking ${money(lead.askingPrice)}` : ''}.
            </Text>
          )}
        </Card>

        <SectionLabel>Qualification</SectionLabel>
        <Card>
          <CampRow label="Motivation" value={lead.sellerMotivation} />
          <CampRow label="Timeline" value={timelineLabel(lead.timeline)} />
          <CampRow
            label="Asking price"
            value={lead.askingPrice != null ? money(lead.askingPrice) : null}
          />
          <CampRow label="Condition" value={lead.conditionLevel} />
        </Card>

        <SectionLabel>Property</SectionLabel>
        <Card>
          <View style={styles.propGrid}>
            <Stat label="Beds" value={lead.bedrooms != null ? String(lead.bedrooms) : '—'} />
            <Stat label="Baths" value={lead.bathrooms != null ? String(lead.bathrooms) : '—'} />
            <Stat label="Sq ft" value={lead.sqft != null ? lead.sqft.toLocaleString() : '—'} />
            <Stat label="Built" value={lead.yearBuilt != null ? String(lead.yearBuilt) : '—'} />
          </View>
          {lead.reapiEquity != null ? (
            <View style={styles.equityRow}>
              <Text style={styles.equityLabel}>Estimated equity</Text>
              <Text style={styles.equityValue}>{money(lead.reapiEquity)}</Text>
            </View>
          ) : null}
        </Card>

        <SectionLabel>Automation</SectionLabel>
        <Card>
          <View style={styles.autoRow}>
            <View style={styles.autoMain}>
              <Text style={styles.autoTitle}>AI auto-reply</Text>
              <Text style={styles.autoSub}>
                {lead.autoRespond
                  ? 'AI is replying to this lead automatically.'
                  : 'Replies are manual — AI is paused.'}
              </Text>
            </View>
            <Switch
              value={!!lead.autoRespond}
              onValueChange={(v) => update.mutate({ autoRespond: v })}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 16, gap: 16, paddingBottom: 40 },

  hero: { width: '100%', height: 170, borderRadius: 16, backgroundColor: colors.bubbleIn },
  headerBlock: { gap: 6 },
  name: { fontSize: 24, fontWeight: '700', color: colors.text },
  address: { fontSize: 15, color: colors.textSecondary },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 4 },

  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 6,
  },
  actionDisabled: { opacity: 0.4 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.text },

  dealCard: { backgroundColor: colors.primaryTint, borderColor: colors.primarySoft, gap: 14 },
  dealHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dealStrategy: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dealStrategyText: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
  conf: { fontSize: 12, color: colors.textSecondary },
  dealGrid: { flexDirection: 'row', gap: 16 },
  dealGridAccent: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primarySoft,
    paddingTop: 12,
  },
  empty: { fontSize: 14, color: colors.textSecondary },

  campRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  campLabel: { fontSize: 14, color: colors.textSecondary, flexShrink: 0 },
  campValue: { fontSize: 14, fontWeight: '500', color: colors.text, flex: 1, textAlign: 'right' },
  campMissing: { color: colors.textMuted, fontWeight: '400', fontStyle: 'italic' },

  propGrid: { flexDirection: 'row', gap: 12 },
  equityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  equityLabel: { fontSize: 14, color: colors.textSecondary },
  equityValue: { fontSize: 15, fontWeight: '600', color: colors.text },

  editBtn: { paddingHorizontal: 4 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  autoMain: { flex: 1, gap: 2 },
  autoTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  autoSub: { fontSize: 13, color: colors.textSecondary },
});
