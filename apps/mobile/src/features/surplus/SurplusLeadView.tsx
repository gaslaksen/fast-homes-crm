import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useUpdateLead, fullName, type LeadDetail } from '@/features/leads/leads';
import { useCall } from '@/features/calls/CallContext';
import { prettyPhone } from '@/features/calls/hooks';
import {
  useLeadPhones,
  showPhoneSheet,
  phoneSubtitle,
  alertDnc,
  type LeadPhone,
} from '@/features/leads/leadPhones';
import {
  useSurplus,
  useUpdateSurplus,
  apiErrorMessage,
  caseLine,
  claimantTypeLabel,
  claimStatusTone,
  contactStatusLabel,
  dueLabel,
  fundLocationLabel,
  mailVerdictLabel,
  mailingAddress,
  nextStage,
  queueTone,
  shortDate,
  stageTone,
  surplusTypeLabel,
  tierStyle,
  DEAD_REASONS,
  DEAD_STAGE,
  SURPLUS_STAGES,
  type SurplusRow,
} from './surplus';
import { Card, SectionLabel, Chip, Stat } from '@/components/ui';
import { PhoneIcon, MessageIcon, MailIcon, CheckIcon, ChevronRight } from '@/components/icons';
import { money } from '@/lib/format';
import { useThemed, type Colors } from '@/theme';

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
  const { styles } = useThemed(makeStyles);
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

/** Label on the left, value on the right, an optional note under the value. */
function Row({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | null | undefined;
  note?: string | null;
  tone?: string;
}) {
  const { styles } = useThemed(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, !value && styles.rowMissing, tone ? { color: tone } : null]}>
          {value || 'Not known'}
        </Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

/** One line of the qualification checklist. */
function Check({ done, label }: { done: boolean; label: string }) {
  const { colors, styles } = useThemed(makeStyles);
  return (
    <View style={styles.check}>
      {done ? (
        <CheckIcon size={16} color={colors.callAccept} />
      ) : (
        <View style={styles.checkEmpty} />
      )}
      <Text style={[styles.checkText, !done && styles.checkTodo]}>{label}</Text>
    </View>
  );
}

/** A warning strip inside a card: obituary, mismatch, compliance. */
function Note({ text, danger }: { text: string; danger?: boolean }) {
  const { styles } = useThemed(makeStyles);
  return <Text style={[styles.note, danger && styles.noteDanger]}>{text}</Text>;
}

function bullets(items: string[]): string {
  return items.map((i) => `• ${i}`).join('\n');
}

/**
 * A surplus claim on the phone: the money, the clock, who to reach and how,
 * where the claim stands, and the stage. The same facts the web's work panel
 * leads with, read from GET /surplus/:id. Documents, notary, filing and the
 * disbursement stay on the web, where their forms are.
 */
export function SurplusLeadView({ lead }: { lead: LeadDetail }) {
  const { colors, styles } = useThemed(makeStyles);
  const router = useRouter();
  const leadId = lead.id;
  const { data: row, isLoading, error } = useSurplus(leadId);
  const update = useUpdateSurplus(leadId);
  const updateLead = useUpdateLead(leadId);
  const { startCall } = useCall();
  const { data: phones } = useLeadPhones(leadId);
  const numbers = phones?.numbers ?? [];
  const name = fullName(lead);
  const callLead = { id: leadId, source: 'SURPLUS' };

  if (isLoading) {
    return <ActivityIndicator style={styles.loading} />;
  }
  if (!row) {
    return (
      <Card>
        <Text style={styles.empty}>
          {apiErrorMessage(error, 'The claim could not be loaded.')} Pull down to try again.
        </Text>
      </Card>
    );
  }

  const r: SurplusRow = row;
  const stage = r.stage || 'New';
  const isDead = stage === DEAD_STAGE;
  const st = stageTone(stage);
  const tier = tierStyle(r.tier);
  const status = claimStatusTone(r.claimStatus);
  const queue = queueTone(r.queue);
  const callable = numbers.filter((n) => !n.dnc && !n.bad);
  const blockCall = r.doNotCall || lead.doNotContact;
  const upcoming = nextStage(stage);
  const upcomingBlocks = (upcoming && r.stageBlocks?.[upcoming]) || [];
  const mailing = mailingAddress(r);
  const verdict = mailVerdictLabel(r.mailVerdict);
  const property = [r.address, r.city].filter(Boolean).join(', ');
  const docLabel = (kind: string) => r.documents.find((d) => d.kind === kind)?.label || kind;

  function call() {
    if (blockCall) {
      Alert.alert('Do not call', `${name} asked not to be contacted. The claim is marked do-not-call.`);
      return;
    }
    if (numbers.length > 1) {
      showPhoneSheet({
        title: 'Call',
        message: `Which number should we dial for ${name}?`,
        numbers,
        onSelect: (p) => startCall(p.number, name, callLead),
      });
      return;
    }
    const only = numbers[0];
    if (only?.dnc) return alertDnc(only);
    const num = only?.number ?? lead.sellerPhone;
    if (num) startCall(num, name, callLead);
  }

  function callNumber(p: LeadPhone, who: string) {
    if (blockCall) return call();
    if (p.dnc) return alertDnc(p);
    startCall(p.number, who, callLead);
  }

  function save(patch: Record<string, unknown>, done?: string) {
    update.mutate(patch, {
      onSuccess: () => {
        if (done) Alert.alert(done);
      },
      onError: (e) => Alert.alert('Not saved', apiErrorMessage(e, 'The change could not be saved.')),
    });
  }

  /**
   * The server is the gate. This only says what a gated stage still needs
   * before asking, so the refusal is never the first anyone hears of it.
   */
  function moveTo(next: string) {
    const blocks = r.stageBlocks?.[next] || [];
    if (blocks.length) {
      Alert.alert(`Not ready for ${next}`, `Still needed:\n${bullets(blocks)}\n\nThese are done on the web.`);
      return;
    }
    Alert.alert(`Move to ${next}?`, isDead ? 'This brings the claim back from Dead.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move', onPress: () => save({ stage: next }) },
    ]);
  }

  function markDead() {
    const labels = DEAD_REASONS.map((d) => d.label);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Why is this claim dead?',
        message: 'A reason is required, so a re-listed case says what happened last time.',
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
      },
      (i) => {
        if (i == null || i >= labels.length) return;
        const reason = DEAD_REASONS[i].value;
        const dead = (extra: Record<string, unknown> = {}) =>
          save({ stage: DEAD_STAGE, deadReason: reason, ...extra });

        // Unresponsive is a claim about the effort, so the effort is checked.
        if (reason === 'unresponsive' && r.deadGateMissing.length) {
          Alert.alert(
            'Not unresponsive yet',
            `Before a claim is unresponsive it still needs:\n${bullets(r.deadGateMissing)}`,
            [
              { text: 'Keep working it', style: 'cancel' },
              {
                text: 'Override',
                style: 'destructive',
                onPress: () =>
                  Alert.prompt(
                    'Why override?',
                    'The note goes on the file so it says what was skipped.',
                    (note) => {
                      if (!note?.trim()) {
                        Alert.alert('A note is required to override.');
                        return;
                      }
                      dead({ deadOverride: true, deadNote: note.trim() });
                    },
                  ),
              },
            ],
          );
          return;
        }
        if (reason === 'other') {
          Alert.prompt('Mark Dead', 'What happened?', (note) => dead({ deadNote: note?.trim() || null }));
          return;
        }
        Alert.alert('Mark Dead?', DEAD_REASONS[i].label, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark Dead', style: 'destructive', onPress: () => dead() },
        ]);
      },
    );
  }

  function changeStage() {
    const options = SURPLUS_STAGES.map((s) => {
      if (s === stage) return `${s} (current)`;
      return r.stageBlocks?.[s]?.length ? `${s} (not ready)` : s;
    });
    const deadIdx = options.length;
    const all = [...options, ...(isDead ? [] : ['Mark Dead']), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Claim stage',
        message: `Now: ${stage}`,
        options: all,
        destructiveButtonIndex: isDead ? undefined : deadIdx,
        cancelButtonIndex: all.length - 1,
      },
      (i) => {
        if (i == null || i >= all.length - 1) return;
        if (!isDead && i === deadIdx) return markDead();
        const next = SURPLUS_STAGES[i];
        if (next && next !== stage) moveTo(next);
      },
    );
  }

  return (
    <>
      <View style={styles.headerBlock}>
        <Text style={[styles.name, r.isDeceased && styles.nameDeceased]}>{name}</Text>
        <Text style={styles.sub}>
          {[claimantTypeLabel(r.claimantType), caseLine(r)].filter(Boolean).join(' · ')}
        </Text>
        {property ? <Text style={styles.sub}>Property: {property}</Text> : null}
        <View style={styles.chipRow}>
          <TouchableOpacity onPress={changeStage} hitSlop={6}>
            <Chip label={`${stage} ▾`} color={st.color} soft={st.soft} />
          </TouchableOpacity>
          <Chip label={r.claimStatusLabel} color={status.color} soft={status.soft} />
          <Chip label={tier.label} color={tier.color} soft={tier.soft} />
          {r.isDeceased ? <Chip label="Estate" color="#6D28D9" soft="#EDE9FE" /> : null}
          {blockCall ? <Chip label="Do not call" color="#B91C1C" soft="#FEE2E2" /> : null}
        </View>
      </View>

      <View style={styles.actions}>
        <ActionButton
          icon={<PhoneIcon size={22} color={colors.primary} />}
          label="Call"
          onPress={call}
          disabled={blockCall || (!lead.sellerPhone && numbers.length === 0)}
        />
        <ActionButton
          icon={<MessageIcon size={22} color={colors.primary} />}
          label="Message"
          onPress={() => router.push({ pathname: '/lead/[id]', params: { id: leadId, from: 'lead' } })}
        />
        <ActionButton
          icon={<MailIcon size={22} color={colors.primary} />}
          label="Email"
          onPress={() => lead.sellerEmail && Linking.openURL(`mailto:${lead.sellerEmail}`)}
          disabled={!lead.sellerEmail}
        />
      </View>

      {/* What to do next: the queue the claimant is in and why, or why it died. */}
      <Card style={styles.nextCard}>
        {isDead ? (
          <>
            <Text style={styles.nextTitle}>Dead: {r.deadReasonLabel || 'no reason recorded'}</Text>
            {r.deadNote ? <Text style={styles.nextBody}>{r.deadNote}</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.nextHead}>
              <Chip label={r.queueLabel} color={queue.color} soft={queue.soft} />
              <Text style={styles.contact}>{contactStatusLabel(r.contactStatus)}</Text>
            </View>
            {r.queueReason ? <Text style={styles.nextBody}>{r.queueReason}</Text> : null}
          </>
        )}
        {r.nextTask ? (
          <Text style={[styles.task, r.overdueTaskCount > 0 && styles.taskOverdue]}>
            Next: {r.nextTask.title} · {dueLabel(r.nextTask.dueDate)}
          </Text>
        ) : null}
        {r.obituaryMatch === 'possible' ? (
          <Note danger text="Possible obituary match. Check before calling." />
        ) : null}
      </Card>

      <SectionLabel>The money</SectionLabel>
      <Card style={styles.moneyCard}>
        <View>
          <Text style={styles.moneyLabel}>Net to claimant</Text>
          <Text style={styles.moneyBig}>{money(r.netToClaimant)}</Text>
        </View>
        <View style={styles.grid}>
          <Stat label="Surplus posted" value={money(r.grossSurplus)} />
          <Stat label="In the notice" value={money(r.surplusAtNotice)} />
        </View>
        <View style={[styles.grid, styles.gridRule]}>
          <Stat label="Liens" value={money(r.totalLiens)} />
          <Stat label="Est. fee" value={money(r.estFee)} accent />
        </View>
        {r.liens.length ? (
          <View style={styles.liens}>
            {r.liens.map((l, i) => (
              <View key={i} style={styles.lien}>
                <Text style={styles.lienText} numberOfLines={1}>
                  {l.holder || l.type}
                  {l.governmental ? ' (gov)' : ''}
                </Text>
                <Text style={styles.lienAmt}>{money(l.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {r.competingLien ? <Note text="A competing lien is on file, so the payout may land under the posted surplus." /> : null}
      </Card>

      <SectionLabel>The clock</SectionLabel>
      <Card>
        <Row
          label="Sale"
          value={shortDate(r.saleDate)}
          note={r.daysSinceSale != null ? `${r.daysSinceSale} days ago` : null}
        />
        <Row label="Sale price" value={r.salePrice != null ? money(r.salePrice) : null} />
        <Row
          label="Notice mailed"
          value={shortDate(r.noticeDate)}
          note={r.noticeDate ? (r.noticeConfirmed ? 'Confirmed with the clerk' : 'Estimate, not confirmed') : null}
        />
        {r.daysRemaining != null ? (
          <Row
            label="Other claims"
            value={
              r.daysRemaining > 0
                ? `Possible until ${shortDate(r.claimDeadline)}`
                : `Closed ${shortDate(r.claimDeadline)}`
            }
            note={r.daysRemaining > 0 ? `${r.daysRemaining} days left` : null}
          />
        ) : null}
        <Row
          label="Last touch"
          value={r.lastTouchedAt ? shortDate(r.lastTouchedAt) : 'Never'}
          note={r.touches ? `${r.touches} touch${r.touches === 1 ? '' : 'es'} so far` : null}
        />
      </Card>

      <SectionLabel>Reach the claimant</SectionLabel>
      <Card style={styles.listCard}>
        {numbers.length ? (
          numbers.map((p) => {
            const off = !!p.dnc || !!p.bad || blockCall;
            return (
              <TouchableOpacity
                key={p.number}
                style={styles.phoneRow}
                onPress={() => callNumber(p, p.label.startsWith('Heir') ? p.label.replace(/^Heir:\s*/, '') : name)}
                activeOpacity={0.7}
              >
                <PhoneIcon size={15} color={off ? colors.textMuted : colors.primary} />
                <View style={styles.phoneText}>
                  <Text style={[styles.phoneNumber, off && styles.phoneOff]}>{prettyPhone(p.number)}</Text>
                  <Text style={[styles.phoneSub, p.dnc ? styles.phoneDnc : null]}>{phoneSubtitle(p)}</Text>
                </View>
                {!off ? <ChevronRight size={15} color={colors.textMuted} /> : null}
              </TouchableOpacity>
            );
          })
        ) : (
          <Text style={styles.empty}>No numbers on file{r.cleanPhoneCount === 0 ? ' yet' : ''}.</Text>
        )}
        {numbers.length && !callable.length && !blockCall ? (
          <Note text="Every number on file is flagged. Nothing here can be dialled." />
        ) : null}
        {r.contactMismatch ? (
          <Note
            danger
            text={`The skip trace came back as ${r.mismatchedName || 'somebody else'}, so its contacts were discarded.`}
          />
        ) : null}
        {r.emails.map((e) => (
          <TouchableOpacity key={e} style={styles.phoneRow} onPress={() => Linking.openURL(`mailto:${e}`)}>
            <MailIcon size={15} color={colors.primary} />
            <Text style={[styles.phoneNumber, styles.phoneText]} numberOfLines={1}>
              {e}
            </Text>
          </TouchableOpacity>
        ))}
      </Card>

      <Card>
        <Row label="Notice went to" value={r.noticeRecipient} />
        <Row label="Mailing address" value={mailing} />
        {verdict ? (
          <Row
            label="Clerk mail"
            value={verdict}
            tone={r.mailVerdict === 'undeliverable' ? colors.danger : undefined}
          />
        ) : null}
        <Row
          label="Our letters"
          value={r.letterCount ? `${r.letterCount} sent` : 'None yet'}
          note={
            r.letters[0]
              ? `Last ${shortDate(r.letters[0].mailedAt)}${r.letterDue ? ', next one is due' : r.letterDueAt ? `, next ${shortDate(r.letterDueAt)}` : ''}`
              : r.letterDue
                ? 'A letter is due'
                : null
          }
        />
        {r.isDeceased ? (
          <Row
            label="Deceased"
            value={r.dateOfDeath ? shortDate(r.dateOfDeath) : 'Yes'}
            note={r.deathSource ? `Per ${r.deathSource}` : 'Per the docket or a filing'}
          />
        ) : null}
      </Card>

      {r.heirs.length ? (
        <>
          <SectionLabel>Heirs and contacts</SectionLabel>
          <Card style={styles.listCard}>
            {r.heirs.map((h) => (
              <View key={h.id} style={styles.heir}>
                <Text style={[styles.heirName, h.deceased && styles.nameDeceased]}>{h.name}</Text>
                <Text style={styles.heirSub}>
                  {[h.roleLabel, h.relationship, h.share ? `share ${h.share}` : null, h.deceased ? 'deceased' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={styles.heirSub}>
                  {h.contactStatusLabel}
                  {h.callable ? ' · callable, numbers listed above' : h.deceased ? '' : ' · no clean number'}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel>Qualify the claim</SectionLabel>
      <Card>
        <Check done={r.entitlementVerified} label="Entitlement verified" />
        <Check done={r.noticeConfirmed} label="Notice date confirmed" />
        <Check done={r.titleSearchComplete} label="Title search complete" />
        <Check
          done={r.docsComplete}
          label={
            r.docsComplete
              ? 'Every required document in hand'
              : `Documents missing: ${r.docsMissing.map(docLabel).join(', ')}`
          }
        />
        {r.compliance.blocks.map((b) => (
          <Note key={b} danger text={b} />
        ))}
        {r.compliance.warns.map((w) => (
          <Note key={w} text={w} />
        ))}
      </Card>

      <SectionLabel>Stage</SectionLabel>
      <Card>
        <TouchableOpacity style={styles.stageRow} onPress={changeStage} activeOpacity={0.7}>
          <View style={styles.stageMain}>
            <Text style={styles.stageNow}>{stage}</Text>
            <Text style={styles.stageHint}>
              {isDead
                ? 'Tap to bring the claim back'
                : upcoming
                  ? upcomingBlocks.length
                    ? `${upcoming} still needs: ${upcomingBlocks.join(', ')}`
                    : `Ready for ${upcoming}`
                  : 'Final stage'}
            </Text>
          </View>
          {update.isPending ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={styles.stageChange}>Change</Text>
          )}
        </TouchableOpacity>
      </Card>

      <SectionLabel>The case</SectionLabel>
      <Card>
        <Row label="County" value={r.county} />
        <Row label="Case" value={r.caseNumber} />
        <Row label="Parcel" value={r.parcelId} />
        <Row label="Type" value={surplusTypeLabel(r.surplusType)} note={fundLocationLabel(r.fundLocation)} />
        <Row label="Docket" value={r.claimStatusLabel} />
        <Row label="Tier" value={tier.label} note={tier.hint} />
      </Card>

      {r.sourceUrl || r.courtRecordsUrl ? (
        <Card style={styles.listCard}>
          {r.sourceUrl ? (
            <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(r.sourceUrl!).catch(() => {})}>
              <View style={styles.phoneText}>
                <Text style={styles.linkLabel}>Clerk case page</Text>
                <Text style={styles.phoneSub}>The docket this claim was read from</Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
          {r.courtRecordsUrl ? (
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => Linking.openURL(r.courtRecordsUrl!).catch(() => {})}
            >
              <View style={styles.phoneText}>
                <Text style={styles.linkLabel}>Court records</Text>
                <Text style={styles.phoneSub}>Probate and estate filings for the county</Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </Card>
      ) : null}

      <SectionLabel>Automation</SectionLabel>
      <Card>
        <View style={styles.autoRow}>
          <View style={styles.stageMain}>
            <Text style={styles.autoTitle}>AI auto-reply</Text>
            <Text style={styles.stageHint}>
              {lead.autoRespond ? 'AI is replying to this claimant automatically.' : 'Replies are manual, AI is paused.'}
            </Text>
          </View>
          <Switch
            value={!!lead.autoRespond}
            onValueChange={(v) => updateLead.mutate({ autoRespond: v })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
      </Card>
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    loading: { marginTop: 40 },
    empty: { fontSize: 14, color: colors.textSecondary, padding: 4 },

    headerBlock: { gap: 4 },
    name: { fontSize: 24, fontWeight: '700', color: colors.text },
    nameDeceased: { textDecorationLine: 'line-through' },
    sub: { fontSize: 14, color: colors.textSecondary },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },

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

    nextCard: { gap: 8 },
    nextHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nextTitle: { fontSize: 15, fontWeight: '700', color: colors.danger },
    nextBody: { fontSize: 14, color: colors.text, lineHeight: 20 },
    contact: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    task: { fontSize: 13, color: colors.textSecondary },
    taskOverdue: { color: colors.danger, fontWeight: '600' },

    note: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginTop: 8,
    },
    noteDanger: { color: colors.danger },

    moneyCard: { backgroundColor: colors.primaryTint, borderColor: colors.primarySoft, gap: 14 },
    moneyLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
    moneyBig: { fontSize: 30, fontWeight: '800', color: colors.primaryDark },
    grid: { flexDirection: 'row', gap: 16 },
    gridRule: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.primarySoft,
      paddingTop: 12,
    },
    liens: {
      gap: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.primarySoft,
      paddingTop: 10,
    },
    lien: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    lienText: { flex: 1, fontSize: 13, color: colors.textSecondary },
    lienAmt: { fontSize: 13, fontWeight: '600', color: colors.text },

    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 8,
      gap: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLabel: { fontSize: 14, color: colors.textSecondary, flexShrink: 0 },
    rowRight: { flex: 1, alignItems: 'flex-end' },
    rowValue: { fontSize: 14, fontWeight: '500', color: colors.text, textAlign: 'right' },
    rowMissing: { color: colors.textMuted, fontWeight: '400', fontStyle: 'italic' },
    rowNote: { fontSize: 12, color: colors.textMuted, marginTop: 2, textAlign: 'right' },

    listCard: { gap: 12 },
    phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    phoneText: { flex: 1 },
    phoneNumber: { fontSize: 15, fontWeight: '600', color: colors.text },
    phoneOff: { color: colors.textMuted, textDecorationLine: 'line-through' },
    phoneSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
    phoneDnc: { color: colors.danger, fontWeight: '600' },

    heir: { gap: 2 },
    heirName: { fontSize: 15, fontWeight: '600', color: colors.text },
    heirSub: { fontSize: 12, color: colors.textSecondary },

    check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    checkEmpty: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.textMuted,
    },
    checkText: { flex: 1, fontSize: 14, color: colors.text },
    checkTodo: { color: colors.textSecondary },

    stageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stageMain: { flex: 1, gap: 2 },
    stageNow: { fontSize: 16, fontWeight: '700', color: colors.text },
    stageHint: { fontSize: 13, color: colors.textSecondary },
    stageChange: { fontSize: 14, fontWeight: '600', color: colors.primary },

    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    linkLabel: { fontSize: 15, fontWeight: '600', color: colors.text },

    autoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    autoTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
