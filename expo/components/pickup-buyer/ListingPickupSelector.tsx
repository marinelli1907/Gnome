// Compact "Available for pickup at" control for Create/Edit Listing.
//
// Renders itself away entirely unless the seller's Market has more than one
// active pickup location — with one spot there is nothing to choose and the
// control would be pure noise. Nothing selected = every spot / the default.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import type { PublicPickupLocation } from '@/lib/marketops';
import { locationTypeLabel } from './labels';

export default function ListingPickupSelector({
  locations,
  selected,
  onChange,
}: {
  locations: PublicPickupLocation[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (locations.length < 2) return null;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };
  const allActive = selected.length === 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Available for pickup at</Text>
      <View style={styles.chipWrap}>
        <Pressable
          onPress={() => onChange([])}
          accessibilityRole="button"
          accessibilityState={{ selected: allActive }}
          accessibilityLabel="Available at every pickup spot"
          style={[styles.chip, allActive && styles.chipActive]}
        >
          <Text style={[styles.chipText, allActive && styles.chipTextActive]}>All spots</Text>
        </Pressable>
        {locations.map((l) => {
          const active = selected.includes(l.location_id);
          return (
            <Pressable
              key={l.location_id}
              onPress={() => toggle(l.location_id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${l.nickname}, ${locationTypeLabel(l.location_type)}${
                active ? '. Selected' : ''
              }`}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {l.nickname}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {allActive
          ? 'Buyers can pick this up at any of your spots.'
          : 'Only the spots you picked will be offered for this item.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8, fontFamily: fonts.semibold },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    maxWidth: '100%',
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  hint: { fontSize: 12, color: Colors.textTertiary, marginTop: 8, fontFamily: fonts.regular },
});
