// Stage progress for the Grow Log: the 8 fixed stages, explicitly mapped —
// the current one highlighted, earlier ones tinted as done, later ones muted.
// Deliberately NO percentage bar: gardens move through stages, not percents.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { STAGES, type GrowStage } from '@/lib/growlog';

export default function StageProgress({ current }: { current: GrowStage | null }) {
  const idx = current ? STAGES.findIndex((s) => s.value === current) : -1;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {STAGES.map((s, i) => {
        const state: 'current' | 'done' | 'todo' =
          i === idx ? 'current' : idx >= 0 && i < idx ? 'done' : 'todo';
        return (
          <View
            key={s.value}
            accessible
            accessibilityLabel={`${s.label}${
              state === 'current' ? ', current stage' : state === 'done' ? ', done' : ''
            }`}
            style={[
              styles.chip,
              state === 'current' && styles.chipCurrent,
              state === 'done' && styles.chipDone,
            ]}
          >
            <Text style={styles.emoji}>{s.emoji}</Text>
            <Text
              style={[
                styles.label,
                state === 'current' && styles.labelCurrent,
                state === 'done' && styles.labelDone,
              ]}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingVertical: 4, paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipCurrent: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipDone: { backgroundColor: Colors.primary + '14', borderColor: Colors.primary + '55' },
  emoji: { fontSize: 14, fontFamily: fonts.regular },
  label: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.textTertiary },
  labelCurrent: { color: Colors.textInverse },
  labelDone: { color: Colors.primary },
});
