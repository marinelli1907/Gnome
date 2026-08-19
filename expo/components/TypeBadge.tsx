import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ListingType } from '@/types';
import { TYPE_LABEL } from '@/lib/listingType';
import { TYPE_BADGE_BG, TYPE_BADGE_FG } from '@/components/listingSemantics';
import { fonts } from '@/constants/theme';

// The badge always carries the type WORD (For Sale / Free / Trade / Wanted /
// Plot), so the hue is reinforcement, never the only signal (identity §1b).
export default function TypeBadge({ type }: { type: ListingType }) {
  const bg = TYPE_BADGE_BG[type] ?? TYPE_BADGE_BG.free;
  const fg = TYPE_BADGE_FG[type] ?? TYPE_BADGE_FG.free;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{TYPE_LABEL[type] ?? 'Free'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  text: { fontSize: 11, fontFamily: fonts.bold },
});
