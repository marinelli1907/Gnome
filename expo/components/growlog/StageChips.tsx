// Optional stage selector — tap to choose, tap the selected one again to clear.
// Stage stays optional so a casual "watered everything" note needs no ceremony.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { STAGES, type GrowStage } from '@/lib/growlog';

export default function StageChips({
  value,
  onChange,
}: {
  value: GrowStage | null;
  onChange: (s: GrowStage | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {STAGES.map((s) => {
        const active = value === s.value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Stage ${s.label}${active ? ', selected, tap to clear' : ''}`}
            onPress={() => onChange(active ? null : s.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>
              {s.emoji} {s.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  text: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  textActive: { color: Colors.textInverse },
});
