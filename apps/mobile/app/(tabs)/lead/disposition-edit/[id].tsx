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
import {
  useDispositionPlan,
  useDispositionCosts,
  useFinalSale,
  useUpsertDispositionPlan,
  useAddDispositionCost,
  useDeleteDispositionCost,
  useUpsertFinalSale,
  useSetRepairEstimate,
  costLabel,
  EXIT_STRATEGIES,
  COST_CATEGORIES,
  type DispositionCost,
} from '@/features/deals/disposition';
import { strategyLabel, useLeadDetail, useUpdateLead } from '@/features/leads/leads';
import { Card, SectionLabel } from '@/components/ui';
import { money } from '@/lib/format';
import { useThemed, type Colors } from '@/theme';

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: KeyboardTypeOptions;
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
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
      />
    </View>
  );
}

function PickerField({
  label,
  value,
  display,
  options,
  onPick,
}: {
  label: string;
  value: string;
  display: (v: string) => string;
  options: string[];
  onPick: (v: string) => void;
}) {
  const { colors, styles } = useThemed(makeStyles);
  function open() {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: label, options: [...options.map(display), 'Cancel'], cancelButtonIndex: options.length },
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
          {value ? display(value) : 'Select'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const num = (s: string): number | undefined => {
  const t = (s ?? '').trim();
  if (!t) return undefined;
  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? undefined : n;
};

export default function DispositionEditScreen() {
  const { colors, styles } = useThemed(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id);
  const router = useRouter();

  const lead = useLeadDetail(leadId);
  const plan = useDispositionPlan(leadId);
  const costs = useDispositionCosts(leadId);
  const sale = useFinalSale(leadId);
  const upsertPlan = useUpsertDispositionPlan(leadId);
  const addCost = useAddDispositionCost(leadId);
  const delCost = useDeleteDispositionCost(leadId);
  const upsertSale = useUpsertFinalSale(leadId);
  const updateLead = useUpdateLead(leadId);
  const setRepairEstimate = useSetRepairEstimate(leadId);

  const [ready, setReady] = useState(false);
  const [arv, setArv] = useState('');
  const [repairs, setRepairs] = useState('');
  const [asking, setAsking] = useState('');
  const [exit, setExit] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [targetClose, setTargetClose] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [buyer, setBuyer] = useState('');
  const [saleClosing, setSaleClosing] = useState('');
  const [closedAt, setClosedAt] = useState('');
  const [costCat, setCostCat] = useState('repair_prep');
  const [costAmt, setCostAmt] = useState('');

  useEffect(() => {
    if (!ready && plan.data !== undefined && sale.data !== undefined && lead.data) {
      setArv(lead.data.arv != null ? String(lead.data.arv) : '');
      setRepairs(lead.data.currentRepairEstimate != null ? String(lead.data.currentRepairEstimate) : '');
      setAsking(lead.data.askingPrice != null ? String(lead.data.askingPrice) : '');
      setExit(plan.data?.exitStrategy ?? '');
      setTargetPrice(plan.data?.targetSalePrice != null ? String(plan.data.targetSalePrice) : '');
      setTargetClose(plan.data?.targetCloseDate ? plan.data.targetCloseDate.slice(0, 10) : '');
      setSalePrice(sale.data?.finalSalePrice != null ? String(sale.data.finalSalePrice) : '');
      setBuyer(sale.data?.buyerName ?? '');
      setSaleClosing(sale.data?.saleClosingCosts != null ? String(sale.data.saleClosingCosts) : '');
      setClosedAt(sale.data?.closedAt ? sale.data.closedAt.slice(0, 10) : '');
      setReady(true);
    }
  }, [plan.data, sale.data, lead.data, ready]);

  const saving = upsertPlan.isPending || upsertSale.isPending || updateLead.isPending || setRepairEstimate.isPending;
  const costList: DispositionCost[] = costs.data ?? [];

  async function onSave() {
    // Deal math: patch ARV/asking on the lead, then set the repair estimate,
    // which recomputes the projected profit (currentDealNumbers) from all three.
    // Best-effort so a recompute hiccup never blocks the disposition save.
    let dealMathFailed = false;
    try {
      await updateLead.mutateAsync({ arv: num(arv) ?? null, askingPrice: num(asking) ?? null } as any);
      await setRepairEstimate.mutateAsync(num(repairs) ?? null);
    } catch {
      dealMathFailed = true;
    }

    try {
      await upsertPlan.mutateAsync({
        exitStrategy: exit || undefined,
        targetSalePrice: num(targetPrice) ?? null,
        targetCloseDate: targetClose.trim() || null,
      });
      if (salePrice.trim()) {
        const price = num(salePrice);
        if (price != null) {
          await upsertSale.mutateAsync({
            finalSalePrice: price,
            buyerName: buyer.trim() || null,
            saleClosingCosts: num(saleClosing) ?? null,
            closedAt: (closedAt.trim() || new Date().toISOString().slice(0, 10)) as any,
          });
        }
      }
    } catch {
      Alert.alert('Error', 'Could not save the deal changes.');
      return;
    }

    if (dealMathFailed) {
      Alert.alert('Saved', 'Deal details saved, but the projected profit could not be recalculated.');
    }
    router.back();
  }

  async function onAddCost() {
    const amount = num(costAmt);
    if (amount == null) return;
    try {
      await addCost.mutateAsync({ category: costCat, amount });
      setCostAmt('');
    } catch {
      // best-effort
    }
  }

  if (plan.isLoading || sale.isLoading || lead.isLoading || !ready) {
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
          title: 'Edit deal',
          headerRight: () => (
            <TouchableOpacity onPress={onSave} disabled={saving} hitSlop={8}>
              {saving ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={styles.save}>Save</Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionLabel>Deal math</SectionLabel>
          <Card>
            <Field label="ARV (after repair value)" value={arv} onChangeText={setArv} keyboardType="number-pad" placeholder="0" />
            <Field label="Repair estimate" value={repairs} onChangeText={setRepairs} keyboardType="number-pad" placeholder="0" />
            <Field label="Asking price" value={asking} onChangeText={setAsking} keyboardType="number-pad" placeholder="0" />
            <Text style={styles.hint}>Updating these recalculates the projected profit and max offer.</Text>
          </Card>

          <SectionLabel>Exit strategy</SectionLabel>
          <Card>
            <PickerField
              label="Strategy"
              value={exit}
              display={strategyLabel}
              options={EXIT_STRATEGIES}
              onPick={setExit}
            />
            <Field label="Target sale price" value={targetPrice} onChangeText={setTargetPrice} keyboardType="number-pad" placeholder="0" />
            <Field label="Target close date" value={targetClose} onChangeText={setTargetClose} placeholder="YYYY-MM-DD" />
          </Card>

          <SectionLabel>Costs</SectionLabel>
          <Card>
            {costList.map((c) => (
              <View key={c.id} style={styles.costRow}>
                <Text style={styles.costLabel}>{costLabel(c.category)}</Text>
                <Text style={styles.costAmt}>{money(c.amount)}</Text>
                <TouchableOpacity onPress={() => delCost.mutate(c.id)} hitSlop={8}>
                  <Text style={styles.remove}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.addCostRow}>
              <TouchableOpacity
                style={styles.catPicker}
                onPress={() =>
                  ActionSheetIOS.showActionSheetWithOptions(
                    { title: 'Category', options: [...COST_CATEGORIES.map(costLabel), 'Cancel'], cancelButtonIndex: COST_CATEGORIES.length },
                    (i) => {
                      if (i != null && i < COST_CATEGORIES.length) setCostCat(COST_CATEGORIES[i]);
                    },
                  )
                }
              >
                <Text style={styles.catText}>{costLabel(costCat)}</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.costInput}
                value={costAmt}
                onChangeText={setCostAmt}
                keyboardType="number-pad"
                placeholder="Amount"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity
                style={[styles.addBtn, !costAmt.trim() && styles.addBtnDisabled]}
                onPress={onAddCost}
                disabled={!costAmt.trim()}
              >
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </Card>

          <SectionLabel>Final sale</SectionLabel>
          <Card>
            <Field label="Sale price" value={salePrice} onChangeText={setSalePrice} keyboardType="number-pad" placeholder="0" />
            <Field label="Buyer" value={buyer} onChangeText={setBuyer} />
            <Field label="Closing costs" value={saleClosing} onChangeText={setSaleClosing} keyboardType="number-pad" placeholder="0" />
            <Field label="Close date" value={closedAt} onChangeText={setClosedAt} placeholder="YYYY-MM-DD" />
            <Text style={styles.hint}>Entering a sale price records the closed sale for this deal.</Text>
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
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  save: { color: colors.primary, fontSize: 16, fontWeight: '700' },

  field: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 3 },
  input: { fontSize: 16, color: colors.text, paddingVertical: 4, minHeight: 26 },
  pickerValue: { fontSize: 16, color: colors.text },
  pickerPlaceholder: { fontSize: 16, color: colors.textMuted },

  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  costLabel: { flex: 1, fontSize: 15, color: colors.text },
  costAmt: { fontSize: 15, fontWeight: '600', color: colors.text },
  remove: { fontSize: 13, color: colors.danger, fontWeight: '600' },
  addCostRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12 },
  catPicker: {
    backgroundColor: colors.bubbleIn,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 100,
  },
  catText: { fontSize: 14, color: colors.text },
  costInput: {
    flex: 1,
    backgroundColor: colors.bubbleIn,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  addBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  hint: { fontSize: 12, color: colors.textMuted, marginTop: 10 },
});
