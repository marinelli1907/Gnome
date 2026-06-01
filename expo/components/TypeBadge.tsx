import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ListingType } from '@/types';
import { TYPE_COLOR, TYPE_LABEL } from '@/lib/listingType';

export default function TypeBadge({ type }: { type: ListingType }) {
  const color = TYPE_COLOR[type] ?? TYPE_COLOR.free;
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.text}>{TYPE_LABEL[type] ?? 'Free'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  text: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
});
