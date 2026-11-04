import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useThemed, type Colors } from '@/theme';
import { RecordingPlayer } from '@/features/calls/RecordingPlayer';
import { useCall } from '@/features/calls/CallContext';
import {
  type AttachOption,
  type NumberSlot,
  type SaveNumberResult,
  type UnknownCall,
  prettyNumber,
  timeAgoLong,
  useAttachCall,
  useAttachSearch,
  useCasePeople,
  useDismissCall,
  useSaveNumber,
  useUnknownCalls,
} from './unknownCallsApi';

const KIND_LABEL: Record<string, string> = {
  voicemail: 'Voicemail',
  missed: 'Missed call',
  answered: 'Answered',
  ringing: 'Ringing now',
};

type Full = Extract<SaveNumberResult, { saved: false }>;

/**
 * "Calls from numbers not on file" at the top of the inbox, as on the web:
 * voicemails, missed calls and answered calls from numbers that matched no
 * lead. Each can be called back, attached to the lead (and person on the
 * case) it turned out to be, or dismissed. Renders nothing when empty.
 */
export function UnknownCalls() {
  const { colors, styles } = useThemed(makeStyles);
  const { data: items = [] } = useUnknownCalls();
  const [open, setOpen] = useState(true);
  const [attaching, setAttaching] = useState<UnknownCall | null>(null);
  /** Attached, waiting on which full slot the number replaces. */
  const [replacing, setReplacing] = useState<{ call: UnknownCall; target: AttachOption; full: Full } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const dismiss = useDismissCall();
  const attachCall = useAttachCall();
  const saveNumber = useSaveNumber();

  const visible = items.filter((c) => !hidden.has(c.id));
  if (!visible.length && !replacing) return null;

  const done = (call: UnknownCall) => {
    setHidden((prev) => new Set(prev).add(call.id));
    setAttaching(null);
    setReplacing(null);
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };

  const attach = async (call: UnknownCall, target: AttachOption, save: boolean) => {
    try {
      await attachCall.mutateAsync({ id: call.id, leadId: target.leadId, heirId: target.heirId });
    } catch {
      Alert.alert('Could not attach that call.');
      return;
    }
    if (!save || !call.fromNumber) return done(call);
    try {
      const res = await saveNumber.mutateAsync({ leadId: target.leadId, heirId: target.heirId, number: call.fromNumber });
      if (res.saved === false) {
        setAttaching(null);
        // iOS will not present a sheet while another is still sliding away.
        setTimeout(() => setReplacing({ call, target, full: res }), 450);
        return;
      }
    } catch (err: any) {
      Alert.alert('The call is attached', `The number was not saved: ${err?.response?.data?.message || 'the save failed.'}`);
    }
    done(call);
  };

  const replace = async (number: string | null) => {
    if (!replacing) return;
    const { call, target } = replacing;
    if (number) {
      try {
        await saveNumber.mutateAsync({ leadId: target.leadId, heirId: target.heirId, number: call.fromNumber || '', replace: number });
      } catch (err: any) {
        Alert.alert('The number was not saved', err?.response?.data?.message || 'The save failed.');
        return;
      }
    }
    done(call);
  };

  const onDismiss = (call: UnknownCall) =>
    Alert.alert('Dismiss this call?', 'It drops off the list. The call log keeps the recording.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Dismiss',
        style: 'destructive',
        onPress: () => {
          setHidden((prev) => new Set(prev).add(call.id));
          dismiss.mutate(call.id);
        },
      },
    ]);

  const busy = attachCall.isPending || saveNumber.isPending;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.header} onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        <Text style={styles.headerText}>Calls from numbers not on file</Text>
        <View style={styles.count}>
          <Text style={styles.countText}>{visible.length}</Text>
        </View>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {open &&
        visible.map((call) => (
          <CallCard
            key={call.id}
            call={call}
            busy={busy}
            onAttach={() => setAttaching(call)}
            onAttachSuggestion={(s) => attach(call, s, true)}
            onDismiss={() => onDismiss(call)}
          />
        ))}

      <AttachSheet
        call={attaching}
        busy={busy}
        onClose={() => setAttaching(null)}
        onPick={(target, save) => attaching && attach(attaching, target, save)}
      />

      <Modal visible={!!replacing} animationType="slide" transparent onRequestClose={() => replace(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {replacing && (
              <ReplacePrompt number={replacing.call.fromNumber || ''} full={replacing.full} busy={busy} onPick={replace} />
            )}
          </View>
        </View>
      </Modal>
      {busy && <ActivityIndicator style={styles.spinner} color={colors.primary} />}
    </View>
  );
}

function CallCard({
  call,
  busy,
  onAttach,
  onAttachSuggestion,
  onDismiss,
}: {
  call: UnknownCall;
  busy: boolean;
  onAttach: () => void;
  onAttachSuggestion: (s: AttachOption) => void;
  onDismiss: () => void;
}) {
  const { colors, styles } = useThemed(makeStyles);
  const { startCall } = useCall();
  const [expanded, setExpanded] = useState(false);
  const kind = call.kind || 'voicemail';

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.number}>{prettyNumber(call.fromNumber) || 'Unknown number'}</Text>
        <Text style={styles.meta}>
          <Text style={kind === 'missed' ? { color: colors.danger, fontWeight: '600' } : undefined}>
            {KIND_LABEL[kind] || 'Call'}
          </Text>
          {` · ${timeAgoLong(call.createdAt)}`}
        </Text>
      </View>

      {kind === 'missed' ? (
        <Text style={styles.muted}>Rang and hung up without leaving a message.</Text>
      ) : call.transcript ? (
        <TouchableOpacity onPress={() => setExpanded((e) => !e)} activeOpacity={0.7}>
          {kind === 'answered' && <Text style={styles.mutedSmall}>Someone took this call. What was said:</Text>}
          <Text style={styles.transcript} numberOfLines={expanded ? undefined : 3}>
            {call.transcript}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.muted}>{kind === 'answered' ? 'Someone took this call. No transcript.' : 'No transcript'}</Text>
      )}

      {call.recordingUrl ? <RecordingPlayer url={call.recordingUrl} durationSec={call.duration} /> : null}

      {(call.suggestions || []).map((s) => (
        <View key={`${s.leadId}:${s.heirId || ''}`} style={styles.suggestion}>
          <Text style={styles.suggestionText}>
            Possibly <Text style={styles.bold}>{s.name}</Text>
            {s.heirId ? ` · ${s.label} on ${s.leadName}` : ` · ${s.label}`}. We have {s.numberOnFile} for them, a few
            digits off this number.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} disabled={busy} onPress={() => onAttachSuggestion(s)}>
            <Text style={styles.primaryBtnText}>Attach and save number</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.actions}>
        {call.fromNumber ? (
          <TouchableOpacity onPress={() => startCall(call.fromNumber!, prettyNumber(call.fromNumber))} hitSlop={6}>
            <Text style={styles.link}>Call back</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onAttach} disabled={busy} hitSlop={6}>
          <Text style={styles.link}>Attach to lead</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} disabled={busy} hitSlop={6}>
          <Text style={styles.linkMuted}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Find who the call was from, then attach. Searches claimants and the people
 * on their cases by name, address or any number on file. Picking a person
 * fills in the lead and who called.
 */
function AttachSheet({
  call,
  busy,
  onClose,
  onPick,
}: {
  call: UnknownCall | null;
  busy: boolean;
  onClose: () => void;
  onPick: (target: AttachOption, save: boolean) => void;
}) {
  const { colors, styles } = useThemed(makeStyles);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<AttachOption | null>(null);
  const [heirId, setHeirId] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const search = useAttachSearch(picked ? '' : q);
  const people = useCasePeople(picked?.leadId || null, picked?.source === 'SURPLUS');

  useEffect(() => {
    if (!call) {
      setQ('');
      setPicked(null);
      setHeirId(null);
      setSave(true);
    }
  }, [call]);

  const choose = (r: AttachOption) => {
    setPicked(r);
    setHeirId(r.heirId);
  };

  return (
    <Modal visible={!!call} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Attach {prettyNumber(call?.fromNumber)}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.link}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {!picked ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Search a name, relative, address or phone"
              placeholderTextColor={colors.textMuted}
              value={q}
              onChangeText={setQ}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {search.isFetching && <ActivityIndicator style={styles.spinner} />}
              {!search.isFetching && q.trim().length >= 2 && !(search.data || []).length && (
                <Text style={styles.empty}>No matches</Text>
              )}
              {(search.data || []).map((r) => (
                <TouchableOpacity key={`${r.leadId}:${r.heirId || ''}`} style={styles.result} onPress={() => choose(r)}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {r.name || r.propertyAddress} <Text style={styles.resultLabel}>· {r.label}</Text>
                  </Text>
                  <Text style={styles.resultSub} numberOfLines={1}>
                    {r.kind === 'person'
                      ? `on ${r.leadName}${r.propertyAddress ? `, ${r.propertyAddress}` : ''}`
                      : r.propertyAddress || ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.pickedBody}>
            <View style={styles.pickedTop}>
              <Text style={styles.resultName}>{picked.leadName || picked.propertyAddress}</Text>
              <TouchableOpacity onPress={() => setPicked(null)} hitSlop={8}>
                <Text style={styles.link}>Change</Text>
              </TouchableOpacity>
            </View>

            {picked.source === 'SURPLUS' && (
              <>
                <Text style={styles.sectionLabel}>Who called</Text>
                {[{ id: null as string | null, name: `${picked.leadName} (claimant)`, sub: '' }]
                  .concat(
                    (people.data || []).map((p) => ({
                      id: p.id,
                      name: p.name,
                      sub: p.relationship || p.roleLabel || '',
                    })),
                  )
                  .concat(
                    // The picked person stays listed while the case's people load.
                    !people.data && picked.heirId ? [{ id: picked.heirId, name: picked.name, sub: picked.label }] : [],
                  )
                  .map((p) => (
                    <Pressable key={p.id || 'claimant'} style={styles.choice} onPress={() => setHeirId(p.id)}>
                      <View style={[styles.radio, heirId === p.id && styles.radioOn]} />
                      <Text style={styles.choiceText} numberOfLines={1}>
                        {p.name}
                        {p.sub ? <Text style={styles.resultLabel}> · {p.sub}</Text> : null}
                      </Text>
                    </Pressable>
                  ))}
                {people.isLoading && <ActivityIndicator style={styles.spinner} />}
              </>
            )}

            {call?.fromNumber ? (
              <View style={styles.saveRow}>
                <Text style={styles.saveText}>
                  Save {prettyNumber(call.fromNumber)} on them, so their next call shows their name
                </Text>
                <Switch value={save} onValueChange={setSave} />
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, styles.bigBtn]}
              disabled={busy}
              onPress={() => onPick({ ...picked, heirId }, save && !!call?.fromNumber)}
            >
              <Text style={styles.primaryBtnText}>Attach</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/** "Called 3 times, last: No answer, 2d ago" or "Never called". */
function slotHistory(p: NumberSlot): string {
  if (!p.calls) return 'Never called';
  const when = timeAgoLong(p.lastCallAt);
  return `Called ${p.calls === 1 ? 'once' : `${p.calls} times`}, last: ${p.lastResult || 'called'}${when ? `, ${when}` : ''}`;
}

/** The person already holds as many numbers as fit: pick one to replace. */
function ReplacePrompt({
  number,
  full,
  busy,
  onPick,
}: {
  number: string;
  full: Full;
  busy: boolean;
  onPick: (replace: string | null) => void;
}) {
  const { colors, styles } = useThemed(makeStyles);
  return (
    <View>
      <Text style={styles.replaceTitle}>The call is attached</Text>
      <Text style={styles.replaceBody}>
        <Text style={styles.bold}>{full.name}</Text> already has {full.capacity} numbers. Replace one with{' '}
        <Text style={styles.bold}>{prettyNumber(number)}</Text>?
      </Text>
      {full.slots.map((p) => (
        <View key={p.number} style={styles.slot}>
          <View style={{ flex: 1 }}>
            <Text style={styles.slotNumber}>
              {prettyNumber(p.number)}
              {p.type ? <Text style={styles.resultLabel}> · {p.type}</Text> : null}
              {p.bad ? <Text style={{ color: colors.danger }}> · marked wrong</Text> : null}
              {p.dnc ? <Text style={{ color: colors.danger }}> · do not call</Text> : null}
              {p.isPrimary ? <Text style={styles.resultLabel}> · primary</Text> : null}
            </Text>
            <Text style={styles.resultSub}>{slotHistory(p)}</Text>
          </View>
          {!p.isPrimary && (
            <TouchableOpacity style={styles.outlineBtn} disabled={busy} onPress={() => onPick(p.number)}>
              <Text style={styles.outlineBtnText}>Replace</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <TouchableOpacity onPress={() => onPick(null)} disabled={busy} style={styles.keepBtn}>
        <Text style={styles.linkMuted}>Keep their numbers, do not save this one</Text>
      </TouchableOpacity>
    </View>
  );
}

const WARM = { light: '#FEF3C7', border: '#F59E0B', text: '#92400E' };

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
    headerText: { fontSize: 14, fontWeight: '700', color: WARM.border, flex: 1 },
    count: { backgroundColor: WARM.light, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
    countText: { fontSize: 12, fontWeight: '700', color: WARM.text },
    chevron: { color: WARM.border, fontSize: 14 },
    card: {
      marginHorizontal: 12,
      marginBottom: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 6,
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    number: { fontSize: 16, fontWeight: '700', color: colors.text },
    meta: { fontSize: 12, color: colors.textSecondary },
    muted: { fontSize: 13, color: colors.textSecondary },
    mutedSmall: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
    transcript: { fontSize: 13, color: colors.text, lineHeight: 18 },
    suggestion: {
      marginTop: 4,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: WARM.border,
      backgroundColor: colors.surface,
      gap: 8,
    },
    suggestionText: { fontSize: 13, color: colors.text, lineHeight: 18 },
    bold: { fontWeight: '700' },
    actions: { flexDirection: 'row', gap: 18, marginTop: 4 },
    link: { color: colors.primary, fontWeight: '600', fontSize: 14 },
    linkMuted: { color: colors.textSecondary, fontSize: 14 },
    primaryBtn: {
      alignSelf: 'flex-start',
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
    },
    primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
    bigBtn: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 12, marginTop: 16 },
    spinner: { marginVertical: 8 },

    page: { flex: 1, backgroundColor: colors.surface },
    pageHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    pageTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
    input: {
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      fontSize: 16,
      color: colors.text,
    },
    empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 16 },
    result: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    resultName: { fontSize: 15, fontWeight: '600', color: colors.text },
    resultLabel: { fontWeight: '400', color: colors.textSecondary },
    resultSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    pickedBody: { paddingHorizontal: 16, paddingBottom: 24 },
    pickedTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: 4, marginBottom: 4 },
    choice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
    radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
    choiceText: { fontSize: 15, color: colors.text, flex: 1 },
    saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
    saveText: { flex: 1, fontSize: 13, color: colors.text },

    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
      paddingBottom: 32,
    },
    replaceTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
    replaceBody: { fontSize: 14, color: colors.text, marginBottom: 10, lineHeight: 20 },
    slot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    slotNumber: { fontSize: 15, fontWeight: '600', color: colors.text },
    outlineBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    outlineBtnText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    keepBtn: { marginTop: 14, alignItems: 'center' },
  });
