import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  useCreateLead,
  LEAD_SOURCES,
  sourceLabel,
  type NewLead,
} from '@/features/leads/leads';
import { Card, SectionLabel } from '@/components/ui';
import { useThemed, type Colors } from '@/theme';

const CONDITIONS = ['excellent', 'good', 'fair', 'poor', 'distressed'];

type Form = Record<string, string>;

const EMPTY: Form = {
  source: 'MANUAL',
  sellerFirstName: '',
  sellerLastName: '',
  sellerPhone: '',
  sellerEmail: '',
  propertyAddress: '',
  propertyCity: '',
  propertyState: '',
  propertyZip: '',
  askingPrice: '',
  conditionLevel: '',
};

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'words' | 'sentences' | 'characters';
  placeholder?: string;
  required?: boolean;
}) {
  const { colors, styles } = useThemed(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

function PickerField({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
}) {
  const { styles } = useThemed(makeStyles);
  const current = options.find((o) => o.value === value);
  function open() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: label,
        options: [...options.map((o) => o.label), 'Cancel'],
        cancelButtonIndex: options.length,
      },
      (i) => {
        if (i != null && i < options.length) onPick(options[i].value);
      },
    );
  }
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.input} onPress={open}>
        <Text style={current ? styles.pickerValue : styles.pickerPlaceholder}>
          {current?.label || 'Select'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Add a lead by hand. The API requires name, phone and a full property address,
 * so those are marked and validated here rather than failing server-side.
 */
export default function NewLeadScreen() {
  const { colors, styles } = useThemed(makeStyles);
  const router = useRouter();
  const create = useCreateLead();
  const [form, setForm] = useState<Form>(EMPTY);
  // The API defaults new leads to autoRespond=true, which texts the seller a
  // few minutes later. A hand-keyed lead starts silent unless asked otherwise.
  const [aiOutreach, setAiOutreach] = useState(false);

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const missing = (['sellerFirstName', 'sellerPhone', 'propertyAddress', 'propertyZip'] as const)
    .filter((k) => !form[k].trim());
  const canSave = missing.length === 0 && !create.isPending;

  async function onSave() {
    if (!canSave) {
      Alert.alert(
        'Missing details',
        'A first name, phone number, street address and ZIP are required.',
      );
      return;
    }

    const num = (s: string): number | undefined => {
      const n = parseFloat((s ?? '').replace(/[^0-9.]/g, ''));
      return Number.isNaN(n) ? undefined : n;
    };

    const lead: NewLead = {
      source: form.source,
      sellerFirstName: form.sellerFirstName.trim(),
      sellerLastName: form.sellerLastName.trim(),
      sellerPhone: form.sellerPhone.trim(),
      sellerEmail: form.sellerEmail.trim() || undefined,
      propertyAddress: form.propertyAddress.trim(),
      // City/state are backfilled from the ZIP by the API when left blank.
      propertyCity: form.propertyCity.trim(),
      propertyState: form.propertyState.trim().toUpperCase(),
      propertyZip: form.propertyZip.trim(),
      askingPrice: num(form.askingPrice),
      conditionLevel: form.conditionLevel || undefined,
      autoRespond: aiOutreach,
    };

    try {
      const created = await create.mutateAsync(lead);
      router.replace({ pathname: '/lead/detail/[id]', params: { id: created.id } });
    } catch (e: any) {
      Alert.alert('Could not add lead', e?.response?.data?.message || 'Please try again.');
    }
  }

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: 'New lead',
          headerRight: () => (
            <TouchableOpacity onPress={onSave} disabled={create.isPending} hitSlop={8}>
              {create.isPending ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={[styles.save, !canSave && styles.saveDisabled]}>Save</Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionLabel>Seller</SectionLabel>
          <Card>
            <Field label="First name" value={form.sellerFirstName} onChangeText={set('sellerFirstName')} autoCapitalize="words" required />
            <Field label="Last name" value={form.sellerLastName} onChangeText={set('sellerLastName')} autoCapitalize="words" />
            <Field label="Phone" value={form.sellerPhone} onChangeText={set('sellerPhone')} keyboardType="phone-pad" required />
            <Field label="Email" value={form.sellerEmail} onChangeText={set('sellerEmail')} keyboardType="email-address" autoCapitalize="none" />
          </Card>

          <SectionLabel>Property</SectionLabel>
          <Card>
            <Field label="Street address" value={form.propertyAddress} onChangeText={set('propertyAddress')} required />
            <Field label="City" value={form.propertyCity} onChangeText={set('propertyCity')} placeholder="Filled from ZIP if blank" />
            <Field label="State" value={form.propertyState} onChangeText={set('propertyState')} autoCapitalize="characters" placeholder="NC" />
            <Field label="ZIP" value={form.propertyZip} onChangeText={set('propertyZip')} keyboardType="number-pad" required />
          </Card>

          <SectionLabel>Deal</SectionLabel>
          <Card>
            <PickerField label="Lead type" value={form.source} options={LEAD_SOURCES} onPick={set('source')} />
            <Field label="Asking price" value={form.askingPrice} onChangeText={set('askingPrice')} keyboardType="number-pad" placeholder="Optional" />
            <PickerField
              label="Condition"
              value={form.conditionLevel}
              options={CONDITIONS.map((c) => ({ value: c, label: c }))}
              onPick={set('conditionLevel')}
            />
          </Card>

          <SectionLabel>Automation</SectionLabel>
          <Card>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>AI initial outreach</Text>
                <Text style={styles.switchHint}>
                  {aiOutreach
                    ? 'AI will text this seller shortly after saving.'
                    : 'Nothing is sent. You start the conversation yourself.'}
                </Text>
              </View>
              <Switch
                value={aiOutreach}
                onValueChange={setAiOutreach}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </Card>

          <Text style={styles.footnote}>
            Saved as a {sourceLabel(form.source)} lead.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  save: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  saveDisabled: { opacity: 0.4 },

  field: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 3 },
  required: { color: colors.danger },
  input: { fontSize: 16, color: colors.text, paddingVertical: 4, minHeight: 26 },
  pickerValue: { fontSize: 16, color: colors.text, textTransform: 'capitalize' },
  pickerPlaceholder: { fontSize: 16, color: colors.textMuted },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  switchHint: { fontSize: 13, color: colors.textSecondary },

  footnote: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
