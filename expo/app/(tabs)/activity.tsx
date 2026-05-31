import React from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { useAuth } from '@/providers/AuthProvider';
import {
  useIncomingClaims,
  useMyClaims,
  useUpdateClaim,
} from '@/lib/db';
import type { ClaimStatus } from '@/types';

const STATUS_COLOR: Record<ClaimStatus, string> = {
  pending: Colors.warning,
  approved: Colors.success,
  declined: Colors.error,
  cancelled: Colors.textTertiary,
};

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const incoming = useIncomingClaims(userId ?? undefined);
  const mine = useMyClaims(userId ?? undefined);
  const updateClaim = useUpdateClaim(userId ?? undefined);

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🔔"
          title="Sign in to see activity"
          subtitle="Track claims on your listings and the items you've claimed."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const act = (claimId: string, status: 'approved' | 'declined' | 'cancelled') => {
    updateClaim.mutate(
      { claimId, status },
      { onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.') },
    );
  };

  const pendingIncoming = (incoming.data ?? []).filter((c) => c.status === 'pending');
  const otherIncoming = (incoming.data ?? []).filter((c) => c.status !== 'pending');

  const refreshing = incoming.isRefetching || mine.isRefetching;
  const onRefresh = () => {
    incoming.refetch();
    mine.refetch();
  };

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
    >
      <Text style={styles.h1}>Activity</Text>

      <Text style={styles.section}>Claims on your listings</Text>
      {pendingIncoming.length === 0 && otherIncoming.length === 0 ? (
        <Text style={styles.muted}>No one has claimed your listings yet.</Text>
      ) : (
        <>
          {pendingIncoming.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Avatar uri={c.claimer?.avatar_url} name={c.claimer?.name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{c.claimer?.name ?? 'A neighbor'}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    wants “{c.listing?.title}”
                  </Text>
                </View>
                <Badge label="Pending" color={STATUS_COLOR.pending} />
              </View>
              <View style={styles.actions}>
                <Button label="Approve" onPress={() => act(c.id, 'approved')} style={{ flex: 1 }} />
                <Button label="Decline" variant="secondary" onPress={() => act(c.id, 'declined')} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
          {otherIncoming.map((c) => (
            <View key={c.id} style={styles.cardRow}>
              <Avatar uri={c.claimer?.avatar_url} name={c.claimer?.name} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.claimer?.name ?? 'A neighbor'}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>{c.listing?.title}</Text>
              </View>
              <Badge label={cap(c.status)} color={STATUS_COLOR[c.status]} />
            </View>
          ))}
        </>
      )}

      <Text style={[styles.section, { marginTop: 28 }]}>Items you&apos;ve claimed</Text>
      {(mine.data ?? []).length === 0 ? (
        <Text style={styles.muted}>You haven&apos;t claimed anything yet. Browse to find surplus near you.</Text>
      ) : (
        (mine.data ?? []).map((c) => (
          <View key={c.id} style={styles.cardRow}>
            <Avatar uri={c.listing?.owner?.avatar_url} name={c.listing?.owner?.name} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{c.listing?.title ?? 'Listing'}</Text>
              <Text style={styles.cardSub}>from {c.listing?.owner?.name ?? 'a neighbor'}</Text>
            </View>
            <Badge label={cap(c.status)} color={STATUS_COLOR[c.status]} />
          </View>
        ))
      )}
    </ScrollView>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  section: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  muted: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cardSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 10 },
});
