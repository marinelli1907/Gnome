import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import { RowSkeleton } from '@/components/Skeleton';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { formatPrice } from '@/lib/listingType';
import { useIncomingClaims, useUpdateClaim } from '@/lib/db';
import type { Claim } from '@/types';

// Owner-facing summary of an incoming request, by type.
function summarize(c: Claim): { verb: string; context: string | null; note: string | null } {
  switch (c.claim_type) {
    case 'trade_offer':
      return { verb: 'offers a trade for', context: c.trade_offer_text ?? null, note: c.buyer_note ?? null };
    case 'purchase_request':
      return {
        verb: 'wants to buy',
        context: c.agreed_price_cents != null ? formatPrice(c.agreed_price_cents) : null,
        note: c.buyer_note ?? null,
      };
    case 'wanted_response':
      return { verb: 'has', context: c.buyer_note ?? null, note: null };
    case 'plot_reservation':
      return {
        verb: 'wants to reserve',
        context: c.agreed_price_cents ? formatPrice(c.agreed_price_cents) : null,
        note: c.buyer_note ?? null, // what they want grown
      };
    default:
      return { verb: 'wants', context: c.buyer_note ?? null, note: null };
  }
}

export default function ClaimsToReview({ uid }: { uid: string }) {
  const router = useRouter();
  const incoming = useIncomingClaims(uid);
  const updateClaim = useUpdateClaim(uid);

  const claims = incoming.data ?? [];
  const pending = claims.filter((c) => c.status === 'pending');
  const approved = claims.filter((c) => c.status === 'approved');

  const act = (claimId: string, status: 'approved' | 'declined', title?: string) => {
    updateClaim.mutate(
      { claimId, status, title },
      { onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.') },
    );
  };

  if (incoming.isLoading) {
    return (
      <View style={{ gap: 10 }}>
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </View>
    );
  }
  if (incoming.error) {
    return (
      <ErrorState
        title="Couldn’t load requests"
        message="Check your connection and try again."
        onRetry={() => incoming.refetch()}
      />
    );
  }
  if (claims.length === 0) {
    return (
      <EmptyState
        emoji="🤝"
        title="No requests yet"
        subtitle="When a neighbor requests something you shared, it shows up here for you to approve."
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {pending.length > 0 && <Text style={styles.section}>Waiting for you</Text>}
      {pending.map((c) => {
        const s = summarize(c);
        return (
          <View key={c.id} style={styles.card}>
            <View style={styles.head}>
              <Avatar uri={c.claimer?.avatar_url} name={c.claimer?.name} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.claimer?.name ?? 'A neighbor'}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {s.verb} “{c.listing?.title}” · {timeAgo(c.created_at)}
                </Text>
              </View>
              <Badge label="Pending" color={Colors.warning} />
            </View>
            {s.context ? <Text style={styles.context}>“{s.context}”</Text> : null}
            {s.note ? <Text style={styles.note}>Note: {s.note}</Text> : null}
            <View style={styles.actions}>
              <Button label="Approve" onPress={() => act(c.id, 'approved', c.listing?.title)} style={{ flex: 1 }} />
              <Button
                label="Decline"
                variant="secondary"
                onPress={() => act(c.id, 'declined', c.listing?.title)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        );
      })}

      {approved.length > 0 && <Text style={[styles.section, { marginTop: 8 }]}>Approved</Text>}
      {approved.map((c) => (
        <View key={c.id} style={styles.row}>
          <Avatar uri={c.claimer?.avatar_url} name={c.claimer?.name} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{c.claimer?.name ?? 'A neighbor'}</Text>
            <Text style={styles.sub} numberOfLines={1}>{c.listing?.title}</Text>
          </View>
          <View style={styles.rightCol}>
            <Pressable onPress={() => router.push(`/chat/${c.id}`)} hitSlop={6}>
              <Text style={styles.link}>Message</Text>
            </Pressable>
            {c.claim_type === 'plot_reservation' && (
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
      ))}
    </View>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const styles = StyleSheet.create({
  section: { fontSize: 14, color: Colors.textSecondary, fontFamily: fonts.bold },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
  name: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 1, fontFamily: fonts.regular },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  context: { fontSize: 14, color: Colors.text, fontStyle: 'italic', marginTop: 4, fontFamily: fonts.regular },
  note: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, fontFamily: fonts.regular },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  link: { color: Colors.primary, fontSize: 13, fontFamily: fonts.bold },
});
