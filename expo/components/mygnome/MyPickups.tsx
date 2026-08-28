import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, EmptyState, ErrorState } from '@/components/ui';
import { RowSkeleton } from '@/components/Skeleton';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
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

  if (mine.isLoading) {
    return (
      <View style={{ gap: 10 }}>
        <RowSkeleton />
        <RowSkeleton />
      </View>
    );
  }
  if (mine.error) {
    return <ErrorState message="Couldn’t load your pickups." onRetry={() => void mine.refetch()} />;
  }
  if (claims.length === 0) {
    return (
      <EmptyState
        emoji="🧺"
        title="No pickups scheduled"
        subtitle="Approved reservations and pickup times will appear here."
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {claims.map((c) => {
        const canMessage = c.status === 'approved' || c.status === 'completed';
        const hasGrowLog = c.claim_type === 'plot_reservation' && canMessage;
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
              {hasGrowLog && (
                <Pressable
                  onPress={() => router.push(`/growlog/${c.id}`)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Open Grow Log"
                >
                  <Text style={styles.link}>🌱 Grow Log</Text>
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
  title: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 1, fontFamily: fonts.regular },
  right: { alignItems: 'flex-end', gap: 6 },
  link: { color: Colors.primary, fontSize: 13, fontFamily: fonts.bold },
});
