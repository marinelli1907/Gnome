import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { useIncomingClaims, useUpdateClaim } from '@/lib/db';

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

  if (claims.length === 0) {
    return (
      <EmptyState
        emoji="🤝"
        title="No claims to review"
        subtitle="When a neighbor claims something you shared, it shows up here for you to approve."
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {pending.length > 0 && <Text style={styles.section}>Waiting for you</Text>}
      {pending.map((c) => (
        <View key={c.id} style={styles.card}>
          <View style={styles.head}>
            <Avatar uri={c.claimer?.avatar_url} name={c.claimer?.name} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{c.claimer?.name ?? 'A neighbor'}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                wants “{c.listing?.title}” · {timeAgo(c.created_at)}
              </Text>
            </View>
            <Badge label="Pending" color={Colors.warning} />
          </View>
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
      ))}

      {approved.length > 0 && <Text style={[styles.section, { marginTop: 8 }]}>Approved</Text>}
      {approved.map((c) => (
        <View key={c.id} style={styles.row}>
          <Avatar uri={c.claimer?.avatar_url} name={c.claimer?.name} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{c.claimer?.name ?? 'A neighbor'}</Text>
            <Text style={styles.sub} numberOfLines={1}>{c.listing?.title}</Text>
          </View>
          <Pressable onPress={() => router.push(`/chat/${c.id}`)} hitSlop={6}>
            <Text style={styles.link}>Message</Text>
          </Pressable>
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
  section: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
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
  name: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 10 },
  link: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
});
