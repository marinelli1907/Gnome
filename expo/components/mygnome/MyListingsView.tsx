import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import RecordSaleSheet, { type SalePrefill } from '@/components/RecordSaleSheet';
import { RowSkeleton } from '@/components/Skeleton';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { categoryFor } from '@/constants/categories';
import { useMyListings, useMyMarket, useUpdateListingStatus } from '@/lib/db';
import { alertUnderReview, isUnderReview, safeErrorText, UNDER_REVIEW_LABEL } from '@/lib/screening';
import { supabase } from '@/lib/supabase';
import type { Listing } from '@/types';

type Group = 'Available' | typeof UNDER_REVIEW_LABEL | 'Paused' | 'Claimed' | 'Completed' | 'Expired';
const GROUP_ORDER: Group[] = ['Available', UNDER_REVIEW_LABEL, 'Paused', 'Claimed', 'Completed', 'Expired'];
const GROUP_COLOR: Record<Group, string> = {
  Available: Colors.success,
  // Under review = saved, held back by screening, waiting on a person. Blue,
  // not amber: there is no action the seller must take for it to move.
  'Under review': Colors.info,
  // Paused = parked by compliance (expired credential or lapsed plan), not by
  // the seller. Amber, not grey: it's actionable and nothing was lost.
  Paused: Colors.warning,
  Claimed: Colors.warning,
  Completed: Colors.textTertiary,
  Expired: Colors.textTertiary,
};

function groupOf(l: Listing): Group {
  const expired = l.status === 'expired' || (l.status === 'active' && new Date(l.expires_at).getTime() < Date.now());
  // Screening parks a held listing as `paused` too, so this has to come first —
  // otherwise a listing a moderator is reading looks like one the seller could
  // fix by renewing a credential. Only while it is still parked: once a
  // moderator resolves it (or the seller removes it) the ordinary rules apply.
  if (isUnderReview(l) && l.status === 'paused') return UNDER_REVIEW_LABEL;
  if (l.status === 'paused') return 'Paused';
  if (l.status === 'completed') return 'Completed';
  if (l.status === 'removed' || expired) return 'Expired';
  if (l.status === 'claimed') return 'Claimed';
  return 'Available';
}

export default function MyListingsView({ uid }: { uid: string }) {
  const router = useRouter();
  const myListings = useMyListings(uid);
  const updateStatus = useUpdateListingStatus(uid);
  const myMarket = useMyMarket(uid);
  const [saleSheet, setSaleSheet] = useState<SalePrefill | null>(null);

  // Complete Exchange → Record Payment bridge. After a sale/plot listing is
  // completed, offer to log the payment against the claim that just closed —
  // claim-linked records are idempotent server-side, so this can never
  // double-count no matter how many times it's tapped.
  const offerRecordSale = async (l: Listing) => {
    if (!myMarket.data?.id) return;
    if (l.listing_type !== 'sale' && l.listing_type !== 'plot') return;
    let claim: { id: string; quantity_requested: number | null; agreed_price_cents: number | null } | null = null;
    try {
      const { data } = await supabase
        .from('claims')
        .select('id,quantity_requested,agreed_price_cents')
        .eq('listing_id', l.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      claim = data;
    } catch {
      // Bridge is best-effort; a manual record from the notebook still works.
    }
    Alert.alert('Record the payment?', 'Add this exchange to your sales notebook. Optional.', [
      { text: 'Skip', style: 'cancel' },
      {
        text: 'Record payment',
        onPress: () =>
          setSaleSheet({
            listingId: l.id,
            listingTitle: l.title,
            claimId: claim?.id ?? null,
            quantity: claim?.quantity_requested ?? 1,
            amountCents:
              claim?.agreed_price_cents ??
              (l.price_cents != null ? l.price_cents * (claim?.quantity_requested ?? 1) : null),
          }),
      },
    ]);
  };

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

  const groups: Record<Group, Listing[]> = {
    Available: [], 'Under review': [], Paused: [], Claimed: [], Completed: [], Expired: [],
  };
  for (const l of listings) groups[groupOf(l)].push(l);

  const markComplete = (l: Listing) =>
    Alert.alert('Mark complete', `Mark “${l.title}” complete?`, [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Mark complete',
        onPress: () =>
          updateStatus.mutate(
            { listingId: l.id, status: 'completed', kind: l.kind, title: l.title },
            {
              onSuccess: () => void offerRecordSale(l),
              // The status write reports a rejected row now instead of shrugging,
              // so say so — a silent no-op here is what sent sellers to a pickup
              // that never got marked done.
              onError: (e: any) =>
                Alert.alert('Couldn’t mark it complete', safeErrorText(e?.message, 'Try again.')),
            },
          ),
      },
    ]);

  const remove = (l: Listing) =>
    Alert.alert('Remove listing', `Remove “${l.title}”?`, [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          updateStatus.mutate(
            { listingId: l.id, status: 'removed', kind: l.kind, title: l.title },
            {
              onError: (e: any) =>
                Alert.alert('Couldn’t remove it', safeErrorText(e?.message, 'Try again.')),
            },
          ),
      },
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
                    {g === UNDER_REVIEW_LABEL && (
                      <>
                        {/* The server's own reason, plus the way to help it
                            along — never the keyword that matched. */}
                        <Pressable onPress={() => alertUnderReview(l)}><Text style={styles.link}>Why under review?</Text></Pressable>
                        <Pressable onPress={() => edit(l)}><Text style={styles.link}>Edit</Text></Pressable>
                      </>
                    )}
                    {g === 'Paused' && (
                      <>
                        <Pressable onPress={() => router.push('/compliance')}><Text style={styles.link}>Why paused?</Text></Pressable>
                        <Pressable onPress={() => edit(l)}><Text style={styles.link}>Edit</Text></Pressable>
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
      {myMarket.data?.id ? (
        <RecordSaleSheet
          visible={!!saleSheet}
          marketId={myMarket.data.id}
          uid={uid}
          prefill={saleSheet}
          onClose={() => setSaleSheet(null)}
        />
      ) : null}
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
