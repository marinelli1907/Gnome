import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import Colors from '@/constants/colors';

/** A single pulsing placeholder block. Skeletons read as faster than spinners. */
export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.block, { opacity }, style]} />;
}

/** Premium single-column listing card skeleton (matches ListingCardV2). */
export function ListingCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton style={styles.image} />
      <View style={styles.body}>
        <Skeleton style={{ width: '70%', height: 18, borderRadius: 6 }} />
        <Skeleton style={{ width: '45%', height: 13, borderRadius: 6, marginTop: 8 }} />
        <Skeleton style={{ width: '100%', height: 44, borderRadius: 12, marginTop: 14 }} />
      </View>
    </View>
  );
}

export function FeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </View>
  );
}

export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton style={{ width: 40, height: 40, borderRadius: 20 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton style={{ width: '60%', height: 14, borderRadius: 6 }} />
        <Skeleton style={{ width: '40%', height: 12, borderRadius: 6 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: Colors.borderLight },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
    marginBottom: 16,
  },
  image: { width: '100%', height: 190 },
  body: { padding: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 10,
  },
});
