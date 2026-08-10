// −30m / +30m time control, storing minutes since midnight. Lifted out of the
// old single-location pickup editor so every per-location schedule editor uses
// the same control (and the same 44pt targets).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { formatMinuteOfDay } from '@/lib/pickuplocations';

export function TimeStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const step = (delta: number) => {
    onChange(Math.min(23 * 60 + 30, Math.max(0, value + delta)));
  };
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.controls}>
        <Pressable
          onPress={() => step(-30)}
          accessibilityRole="button"
          accessibilityLabel={`${label} 30 minutes earlier`}
          style={styles.btn}
        >
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <Text style={styles.value} accessibilityLabel={`${label} ${formatMinuteOfDay(value)}`}>
          {formatMinuteOfDay(value)}
        </Text>
        <Pressable
          onPress={() => step(30)}
          accessibilityRole="button"
          accessibilityLabel={`${label} 30 minutes later`}
          style={styles.btn}
        >
          <Text style={styles.btnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: {
    minWidth: 82,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: fonts.bold,
    color: Colors.text,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 20, fontFamily: fonts.bold, color: Colors.primary, lineHeight: 24 },
});

export default TimeStepper;
