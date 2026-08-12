import { ActionSheetIOS, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCall } from './callState';
import { prettyPhone } from './hooks';
import { PhoneIcon, ChevronRight } from '@/components/icons';
import { useThemed, type Colors } from '@/theme';

/**
 * "Calling from" control. Shows which of the org's numbers outbound calls
 * present, and lets the user switch. The choice is remembered across launches
 * and is re-validated by the API before any call is placed.
 *
 * Renders nothing when the org has one number or none: there is nothing to
 * choose, and a picker with a single option is just noise.
 */
export function CallerIdPicker({ compact }: { compact?: boolean }) {
  const { colors, styles } = useThemed(makeStyles);
  const { callerIds, callerId, setCallerId } = useCall();

  if (callerIds.length < 2) return null;

  const current = callerId ?? callerIds[0];
  const subtitle =
    current.label && current.label !== prettyPhone(current.number)
      ? `${current.label} · ${prettyPhone(current.number)}`
      : prettyPhone(current.number);

  function open() {
    const labels = callerIds.map((c) =>
      c.label && c.label !== prettyPhone(c.number)
        ? `${c.label} · ${prettyPhone(c.number)}`
        : prettyPhone(c.number),
    );
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Calling from',
        message: 'The number sellers see when you call.',
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
      },
      (i) => {
        if (i != null && i < callerIds.length) setCallerId(callerIds[i]);
      },
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, compact && styles.rowCompact]}
      onPress={open}
      activeOpacity={0.7}
    >
      <PhoneIcon size={16} color={colors.textSecondary} />
      <View style={styles.text}>
        <Text style={styles.label}>Calling from</Text>
        <Text style={styles.value} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  rowCompact: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.bubbleIn,
  },
  text: { flex: 1 },
  label: { fontSize: 12, color: colors.textMuted },
  value: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 1 },
});
