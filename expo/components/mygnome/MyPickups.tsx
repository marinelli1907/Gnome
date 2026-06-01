import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { useMyClaims } from '@/lib/db';
import type { ClaimStatus } from '@/types';

const STATUS_COLOR: Record<ClaimStatus, string> = {
  pending: Colors.warning,
  approved: Colors.success,
  completed: Colors.textTertiary,
  declined: Colors.error,
  cancelled: Colors.textTertiary,
  expired: Colors.textTertiary,
};

export default function MyPickups({ uid }: { uid: string }) {
  const router = useRouter();
  const mine = useMyClaims(uid);
  const claims = mine.data ?? [];

  if (claims.length === 0) {
    return (
      <EmptyState
        emoji="🧺"
        title="No pickups yet"
        subtitle="When you claim something from a neighbor, you'll track it here."
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {claims.map((c) => {
        const canMessage = c.status === 'approved' || c.status === 'completed';
        return (
          <View key={c.id} style={styles.row}>
            <Avatar uri={c.listing?.owner?.avatar_url} name={c.listing?.owner?.name} size={34} />
            <Pressable style={{ flex: 1 }} onPress={() => c.listing && router.push(`/listing/${c.listing.id}`)}>
              <Text style={styles.title} numberOfLines={1}>{c.listing?.title ?? 'Listing'}</Text>
              <Text style={styles.sub}>from {c.listing?.owner?.name ?? 'a neighbor'}</Text>
            </Pressable>
            <View style={styles.right}>
              <Badge label={cap(c.status)} color={STATUS_COLOR[c.status]} />
              {canMessage && (
                <Pressable onPress={() => router.push(`/chat/${c.id}`)} hitSlop={6}>
                  <Text style={styles.link}>Message</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 6 },
  link: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
});
