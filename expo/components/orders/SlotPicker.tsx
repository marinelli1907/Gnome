// Pickup slot picker — horizontal day chips + a wrapping grid of time chips.
// Fed exclusively by usePickupSlots (server-generated slots are the single
// source of truth for what's bookable). Used by the buyer order flow and the
// seller "suggest a different time" sheet.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { ErrorState } from '@/components/ui';
import type { PickupSlot } from '@/lib/marketops';

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function SlotPicker({
  slots,
  loading,
  isError,
  onRetry,
  selected,
  onSelect,
}: {
  slots: PickupSlot[];
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  selected: PickupSlot | null;
  onSelect: (s: PickupSlot) => void;
}) {
  const days = useMemo(() => {
    const map = new Map<string, PickupSlot[]>();
    for (const s of slots) {
      const k = dayKey(s.slot_start);
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries()); // insertion order = chronological (server sorted)
  }, [slots]);

  const [dayIdx, setDayIdx] = useState(0);
  const activeIdx = Math.min(dayIdx, Math.max(days.length - 1, 0));

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (isError) {
    return <ErrorState message="Couldn’t load pickup times." onRetry={onRetry} />;
  }
  if (days.length === 0) {
    return (
      <Text style={styles.noneText}>
        No pickup times are available right now — check back soon.
      </Text>
    );
  }

  const [, daySlots] = days[activeIdx];

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayRow}
      >
        {days.map(([key, list], i) => {
          const active = i === activeIdx;
          return (
            <Pressable
              key={key}
              onPress={() => setDayIdx(i)}
              accessibilityRole="button"
              accessibilityLabel={`Show pickup times for ${dayLabel(list[0].slot_start)}`}
              accessibilityState={{ selected: active }}
              style={[styles.dayChip, active && styles.dayChipActive]}
            >
              <Text style={[styles.dayText, active && styles.dayTextActive]}>
                {dayLabel(list[0].slot_start)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.slotGrid}>
        {daySlots.map((s) => {
          const active = selected?.slot_start === s.slot_start;
          return (
            <Pressable
              key={s.slot_start}
              onPress={() => onSelect(s)}
              accessibilityRole="button"
              accessibilityLabel={`Pickup at ${fmtTime(s.slot_start)}${
                s.remaining != null ? `, ${s.remaining} left` : ''
              }`}
              accessibilityState={{ selected: active }}
              style={[styles.slotChip, active && styles.slotChipActive]}
            >
              <Text style={[styles.slotText, active && styles.slotTextActive]}>
                {fmtTime(s.slot_start)}
              </Text>
              {s.remaining != null ? (
                <Text style={[styles.slotLeft, active && styles.slotTextActive]}>
                  {s.remaining} left
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { paddingVertical: 24, alignItems: 'center' },
  noneText: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: Colors.textSecondary,
    lineHeight: 19,
    paddingVertical: 8,
  },
  dayRow: { gap: 8, paddingVertical: 4 },
  dayChip: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  dayTextActive: { color: Colors.textInverse },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  slotChip: {
    minHeight: 48,
    minWidth: 86,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  slotText: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text },
  slotTextActive: { color: Colors.textInverse },
  slotLeft: { fontSize: 11, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 1 },
});
