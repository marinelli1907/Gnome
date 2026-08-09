import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import { RowSkeleton } from '@/components/Skeleton';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { categoryFor } from '@/constants/categories';
import { useMyListings, useUpdateListingStatus } from '@/lib/db';
import type { Listing } from '@/types';

type Group = 'Available' | 'Claimed' | 'Completed' | 'Expired';
const GROUP_ORDER: Group[] = ['Available', 'Claimed', 'Completed', 'Expired'];
const GROUP_COLOR: Record<Group, string> = {
  Available: Colors.success,
  Claimed: Colors.warning,
  Completed: Colors.textTertiary,
  Expired: Colors.textTertiary,
};

function groupOf(l: Listing): Group {
  const expired = l.status === 'expired' || (l.status === 'active' && new Date(l.expires_at).getTime() < Date.now());
  if (l.status === 'completed') return 'Completed';
  if (l.status === 'removed' || expired) return 'Expired';
  if (l.status === 'claimed') return 'Claimed';
  return 'Available';
}

export default function MyListingsView({ uid }: { uid: string }) {
  const router = useRouter();
  const myListings = useMyListings(uid);
  const updateStatus = useUpdateListingStatus(uid);

  const listings = myListings.data ?? [];
  if (myListings.isLoading) {
    return (
      <View style={{ gap: 10 }}>
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </View>
    );
  }
  if (myListings.error) {
    return <ErrorState message="Couldn’t load your listings." onRetry={() => void myListings.refetch()} />;
  }
  if (listings.length === 0) {
    return (
      <EmptyState
        emoji="🌱"
        title="Nothing posted yet"
        subtitle="Share surplus or post a want from the Post tab — it'll show up here."
      />
    );
  }

  const groups: Record<Group, Listing[]> = { Available: [], Claimed: [], Completed: [], Expired: [] };
  for (const l of listings) groups[groupOf(l)].push(l);

  const markComplete = (l: Listing) =>
    Alert.alert('Mark complete', `Mark “${l.title}” complete?`, [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Mark complete',
        onPress: () => updateStatus.mutate({ listingId: l.id, status: 'completed', kind: l.kind, title: l.title }),
      },
    ]);

  const remove = (l: Listing) =>
    Alert.alert('Remove listing', `Remove “${l.title}”?`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => updateStatus.mutate({ listingId: l.id, status: 'removed', kind: l.kind, title: l.title }) },
    ]);

  const repost = (l: Listing) =>
    router.push({
      pathname: '/post',
      params: {
        type: l.listing_type ?? (l.kind === 'wanted' ? 'wanted' : 'free'),
        category: l.category,
        title: l.title,
        quantity: l.quantity ?? '',
        description: l.description ?? '',
        // nonce so re-posting the same listing twice still re-seeds the form
        // (the Post screen keys its seeding effect on these params)
        n: String(Date.now()),
      },
    });

  const edit = (l: Listing) => router.push(`/edit-listing/${l.id}`);

  return (
    <View style={{ gap: 18 }}>
      {GROUP_ORDER.map((g) =>
        groups[g].length === 0 ? null : (
          <View key={g} style={{ gap: 10 }}>
            <Text style={styles.section}>
              {g} <Text style={styles.count}>{groups[g].length}</Text>
            </Text>
            {groups[g].map((l) => {
              const cat = categoryFor(l.category);
              return (
                <View key={l.id} style={styles.card}>
                  <Pressable style={styles.main} onPress={() => router.push(`/listing/${l.id}`)}>
                    <Text style={styles.title} numberOfLines={1}>
                      {cat.emoji} {l.kind === 'wanted' ? `Looking for ${l.title}` : l.title}
                    </Text>
                    <Text style={styles.sub}>
                      {(l.claim_count ?? 0)} claim{(l.claim_count ?? 0) === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                  <Badge label={g} color={GROUP_COLOR[g]} />
                  <View style={styles.actions}>
                    {(g === 'Available' || g === 'Claimed') && (
                      <>
                        {l.is_featured ? (
                          <Text style={styles.featured}>✨ Featured</Text>
                        ) : (
                          <Pressable onPress={() => router.push(`/promote/${l.id}`)}><Text style={styles.link}>Promote</Text></Pressable>
                        )}
                        <Pressable onPress={() => edit(l)}><Text style={styles.link}>Edit</Text></Pressable>
                        <Pressable onPress={() => markComplete(l)}><Text style={styles.link}>Mark Complete</Text></Pressable>
                        <Pressable onPress={() => remove(l)}><Text style={styles.linkDanger}>Remove</Text></Pressable>
                      </>
                    )}
                    {g === 'Expired' && (
                      <Pressable onPress={() => repost(l)}><Text style={styles.link}>Repost</Text></Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, color: Colors.text, fontFamily: fonts.bold },
  count: { fontSize: 14, color: Colors.textTertiary, fontFamily: fonts.bold },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  main: { flex: 1 },
  title: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontFamily: fonts.regular },
  actions: { alignItems: 'flex-end', gap: 6 },
  link: { color: Colors.primary, fontSize: 13, fontFamily: fonts.bold },
  linkDanger: { color: Colors.error, fontSize: 13, fontFamily: fonts.semibold },
  featured: { color: Colors.text, fontSize: 13, fontFamily: fonts.bold },
});
