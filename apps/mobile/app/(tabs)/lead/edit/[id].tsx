import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useLeadDetail, useUpdateLead, type LeadDetail } from '@/features/leads/leads';
import { Card, SectionLabel } from '@/components/ui';
import { useThemed, type Colors } from '@/theme';

const CONDITIONS = ['excellent', 'good', 'fair', 'poor', 'distressed'];

type Form = Record<string, string>;

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  placeholder?: string;
}) {
  const { colors, styles } = useThemed(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
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
  options: string[];
  onPick: (v: string) => void;
}) {
  const { colors, styles } = useThemed(makeStyles);
  function open() {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: label, options: [...options, 'Cancel'], cancelButtonIndex: options.length },
      (i) => {
        if (i != null && i < options.length) onPick(options[i]);
      },
    );
  }
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.input} onPress={open}>
        <Text style={value ? styles.pickerValue : styles.pickerPlaceholder}>
          {value || 'Select'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function LeadEditScreen() {
  const { colors, styles } = useThemed(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id);
  const router = useRouter();
  const { data: lead, isLoading } = useLeadDetail(leadId);
  const update = useUpdateLead(leadId);
  const [form, setForm] = useState<Form>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (lead && !ready) {
      setForm({
        sellerFirstName: lead.sellerFirstName ?? '',
        sellerLastName: lead.sellerLastName ?? '',
        sellerPhone: lead.sellerPhone ?? '',
        sellerEmail: lead.sellerEmail ?? '',
        propertyAddress: lead.propertyAddress ?? '',
        propertyCity: lead.propertyCity ?? '',
        propertyState: lead.propertyState ?? '',
        propertyZip: lead.propertyZip ?? '',
        bedrooms: lead.bedrooms != null ? String(lead.bedrooms) : '',
        bathrooms: lead.bathrooms != null ? String(lead.bathrooms) : '',
        sqft: lead.sqft != null ? String(lead.sqft) : '',
        yearBuilt: lead.yearBuilt != null ? String(lead.yearBuilt) : '',
        askingPrice: lead.askingPrice != null ? String(lead.askingPrice) : '',
        conditionLevel: lead.conditionLevel ?? '',
      });
      setReady(true);
    }
  }, [lead, ready]);

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSave() {
    const num = (s: string): number | null => {
      const t = (s ?? '').trim();
      if (!t) return null;
      const n = parseFloat(t);
      return Number.isNaN(n) ? null : n;
    };
    const patch: Partial<LeadDetail> = {
      sellerFirstName: form.sellerFirstName.trim() || null,
      sellerLastName: form.sellerLastName.trim() || null,
      sellerPhone: form.sellerPhone.trim() || null,
      sellerEmail: form.sellerEmail.trim() || null,
      propertyAddress: form.propertyAddress.trim() || null,
      propertyCity: form.propertyCity.trim() || null,
      propertyState: form.propertyState.trim() || null,
      propertyZip: form.propertyZip.trim() || null,
      bedrooms: num(form.bedrooms),
      bathrooms: num(form.bathrooms),
      sqft: num(form.sqft),
      yearBuilt: num(form.yearBuilt),
      askingPrice: num(form.askingPrice),
      conditionLevel: form.conditionLevel.trim() || null,
    };
    try {
      await update.mutateAsync(patch);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save changes.');
    }
  }

  if (isLoading || !ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity onPress={onSave} disabled={update.isPending} hitSlop={8}>
              {update.isPending ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={styles.save}>Save</Text>
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
          <SectionLabel>Contact</SectionLabel>
          <Card>
            <Field label="First name" value={form.sellerFirstName} onChangeText={set('sellerFirstName')} autoCapitalize="words" />
            <Field label="Last name" value={form.sellerLastName} onChangeText={set('sellerLastName')} autoCapitalize="words" />
            <Field label="Phone" value={form.sellerPhone} onChangeText={set('sellerPhone')} keyboardType="phone-pad" />
            <Field label="Email" value={form.sellerEmail} onChangeText={set('sellerEmail')} keyboardType="email-address" autoCapitalize="none" />
          </Card>

          <SectionLabel>Property</SectionLabel>
          <Card>
            <Field label="Address" value={form.propertyAddress} onChangeText={set('propertyAddress')} />
            <Field label="City" value={form.propertyCity} onChangeText={set('propertyCity')} />
            <Field label="State" value={form.propertyState} onChangeText={set('propertyState')} autoCapitalize="none" />
            <Field label="ZIP" value={form.propertyZip} onChangeText={set('propertyZip')} keyboardType="number-pad" />
            <Field label="Beds" value={form.bedrooms} onChangeText={set('bedrooms')} keyboardType="number-pad" />
            <Field label="Baths" value={form.bathrooms} onChangeText={set('bathrooms')} keyboardType="decimal-pad" />
            <Field label="Sq ft" value={form.sqft} onChangeText={set('sqft')} keyboardType="number-pad" />
            <Field label="Year built" value={form.yearBuilt} onChangeText={set('yearBuilt')} keyboardType="number-pad" />
          </Card>

          <SectionLabel>Deal</SectionLabel>
          <Card>
            <Field label="Asking price" value={form.askingPrice} onChangeText={set('askingPrice')} keyboardType="number-pad" placeholder="0" />
            <PickerField label="Condition" value={form.conditionLevel} options={CONDITIONS} onPick={set('conditionLevel')} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  save: { color: colors.primary, fontSize: 16, fontWeight: '700' },

  field: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 3 },
  input: {
    fontSize: 16,
    color: colors.text,
    paddingVertical: 4,
    minHeight: 26,
  },
  pickerValue: { fontSize: 16, color: colors.text, textTransform: 'capitalize' },
  pickerPlaceholder: { fontSize: 16, color: colors.textMuted },
});
