import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCall } from './callState';
import {
  SURPLUS_OUTCOMES,
  SURPLUS_OBJECTIONS,
  apiErrorMessage,
  callConnected,
  followUpRule,
  quickDueDates,
} from '@/features/surplus/surplus';

/**
 * The end of a surplus call, as the web dialer's summary has it: an outcome
 * in recovery vocabulary, the objection heard, and a follow-up that must
 * carry a date before the call can be closed. The API applies the effects
 * (Tapped, Contacted, a task, DNC), so this only has to ask.
 */
export function SurplusOutcomeForm() {
  const { saveOutcome, dismiss } = useCall();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [objection, setObjection] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<{ label: string; at: Date } | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rule = followUpRule(outcome);
  const connected = callConnected(outcome);
  const picks = useMemo(quickDueDates, [outcome]);
  const canSave = !!outcome && (rule !== 'required' || !!followUp) && !saving;

  async function save() {
    if (!outcome || !canSave) return;
    setSaving(true);
    setErr(null);
    try {
      await saveOutcome({
        disposition: SURPLUS_OUTCOMES.find((o) => o.value === outcome)?.label || outcome,
        outcome,
        objection: connected ? objection : null,
        notes: notes.trim() || undefined,
        followUpAt: rule !== 'none' && followUp ? followUp.at.toISOString() : null,
      });
      dismiss();
    } catch (e) {
      setErr(apiErrorMessage(e, 'The call outcome could not be saved. Try again.'));
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>What happened</Text>
      <View style={styles.grid}>
        {SURPLUS_OUTCOMES.map((o) => (
          <TouchableOpacity
            key={o.value}
            style={[styles.pick, styles.pickHalf, outcome === o.value && styles.pickOn]}
            onPress={() => {
              setOutcome(o.value);
              setFollowUp(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.pickText, outcome === o.value && styles.pickTextOn]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {connected ? (
        <>
          <Text style={styles.label}>Objection raised</Text>
          <View style={styles.grid}>
            {SURPLUS_OBJECTIONS.map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[styles.pick, objection === o.value && styles.pickOn]}
                onPress={() => setObjection(objection === o.value ? null : o.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pickText, objection === o.value && styles.pickTextOn]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      {outcome && rule !== 'none' ? (
        <>
          <Text style={styles.label}>
            Follow up{' '}
            <Text style={rule === 'required' ? styles.required : styles.optional}>
              {rule === 'required' ? '(needs a date)' : '(optional)'}
            </Text>
          </Text>
          <View style={styles.grid}>
            {picks.map((p) => (
              <TouchableOpacity
                key={p.label}
                style={[styles.pick, followUp?.label === p.label && styles.pickOn]}
                onPress={() => setFollowUp(followUp?.label === p.label ? null : p)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pickText, followUp?.label === p.label && styles.pickTextOn]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {followUp ? (
            <Text style={styles.when}>
              {followUp.at.toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          ) : null}
        </>
      ) : null}

      <TextInput
        style={styles.notes}
        value={notes}
        onChangeText={setNotes}
        placeholder="What was said"
        placeholderTextColor="#6B7280"
        multiline
      />

      {err ? <Text style={styles.error}>{err}</Text> : null}

      <TouchableOpacity
        style={[styles.save, !canSave && styles.saveOff]}
        onPress={save}
        disabled={!canSave}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>
            {!outcome ? 'Pick what happened' : rule === 'required' && !followUp ? 'Pick a follow-up' : 'Save and close'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={dismiss} hitSlop={10} style={styles.skip} disabled={saving}>
        <Text style={styles.skipText}>Close without logging</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, alignSelf: 'stretch' },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  label: { color: '#9CA3AF', fontSize: 13, fontWeight: '600', marginTop: 8 },
  required: { color: '#F87171' },
  optional: { color: '#6B7280', fontWeight: '400' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  pickHalf: { width: '48.5%' },
  pickOn: { backgroundColor: '#0D9488', borderColor: '#0D9488' },
  pickText: { color: '#E5E7EB', fontSize: 13, fontWeight: '500' },
  pickTextOn: { color: '#fff', fontWeight: '700' },
  when: { color: '#5EEAD4', fontSize: 13, fontWeight: '600' },
  notes: {
    marginTop: 8,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  error: { color: '#F87171', fontSize: 14 },
  save: {
    marginTop: 8,
    backgroundColor: '#0D9488',
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveOff: { opacity: 0.4 },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: 8 },
  skipText: { color: '#9CA3AF', fontSize: 14 },
});
