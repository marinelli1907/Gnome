import React from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Package, HandHeart, LogOut } from 'lucide-react-native';
import { Avatar, Badge, Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { categoryFor } from '@/constants/categories';
import { useAuth } from '@/providers/AuthProvider';
import {
  useMyListings,
  useProfile,
  useProfileStats,
  useUpdateListingStatus,
} from '@/lib/db';
import type { ListingStatus } from '@/types';

const STATUS_COLOR: Record<ListingStatus, string> = {
  active: Colors.success,
  claimed: Colors.warning,
  completed: Colors.textTertiary,
  expired: Colors.textTertiary,
  removed: Colors.error,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId, signOut } = useAuth();
  const profile = useProfile(userId ?? undefined);
  const stats = useProfileStats(userId ?? undefined);
  const myListings = useMyListings(userId ?? undefined);
  const updateStatus = useUpdateListingStatus(userId ?? undefined);

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🧑‍🌾"
          title="Your Gnome profile"
          subtitle="Sign in to post surplus, claim items, and build neighborhood trust."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const memberSince = stats.data
    ? new Date(stats.data.memberSince).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
    : '—';

  const confirmStatus = (listingId: string, status: 'completed' | 'removed') => {
    const verb = status === 'completed' ? 'Mark as picked up' : 'Remove listing';
    Alert.alert(verb, `${verb}?`, [
      { text: 'Back', style: 'cancel' },
      { text: verb, onPress: () => updateStatus.mutate({ listingId, status }) },
    ]);
  };

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={myListings.isRefetching}
          onRefresh={() => {
            myListings.refetch();
            stats.refetch();
          }}
          tintColor={Colors.primary}
        />
      }
    >
      <View style={styles.headerCard}>
        <Avatar uri={profile.data?.avatar_url} name={profile.data?.name} size={64} />
        <Text style={styles.name}>{profile.data?.name ?? 'Neighbor'}</Text>
        {profile.data?.zip_code ? (
          <Text style={styles.zip}>📍 {profile.data.zip_code}</Text>
        ) : null}
      </View>

      <View style={styles.trustRow}>
        <Trust icon={<CalendarDays size={18} color={Colors.primary} />} value={memberSince} label="Member since" />
        <Trust icon={<Package size={18} color={Colors.primary} />} value={String(stats.data?.postsShared ?? 0)} label="Posts shared" />
        <Trust icon={<HandHeart size={18} color={Colors.primary} />} value={String(stats.data?.claimsCompleted ?? 0)} label="Claims done" />
      </View>

      <Text style={styles.section}>Your listings</Text>
      {(myListings.data ?? []).length === 0 ? (
        <Text style={styles.muted}>No listings yet. Tap Post to share your first surplus.</Text>
      ) : (
        (myListings.data ?? []).map((l) => {
          const cat = categoryFor(l.category);
          return (
            <View key={l.id} style={styles.listingRow}>
              <Pressable style={styles.listingMain} onPress={() => router.push(`/listing/${l.id}`)}>
                <Text style={styles.listingTitle} numberOfLines={1}>
                  {cat.emoji} {l.title}
                </Text>
                <Text style={styles.listingSub}>
                  {l.claim_count ?? 0} claim{(l.claim_count ?? 0) === 1 ? '' : 's'}
                </Text>
              </Pressable>
              <Badge label={cap(l.status)} color={STATUS_COLOR[l.status]} />
              {(l.status === 'active' || l.status === 'claimed') && (
                <View style={styles.listingActions}>
                  <Pressable onPress={() => confirmStatus(l.id, 'completed')}>
                    <Text style={styles.linkDone}>Done</Text>
                  </Pressable>
                  <Pressable onPress={() => confirmStatus(l.id, 'removed')}>
                    <Text style={styles.linkCancel}>Remove</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })
      )}

      <Pressable style={styles.signOut} onPress={() => signOut()}>
        <LogOut size={18} color={Colors.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Trust({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.trustItem}>
      {icon}
      <Text style={styles.trustValue}>{value}</Text>
      <Text style={styles.trustLabel}>{label}</Text>
    </View>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: { alignItems: 'center', gap: 6, paddingVertical: 12 },
  name: { fontSize: 22, fontWeight: '800', color: Colors.text },
  zip: { fontSize: 14, color: Colors.textSecondary },
  trustRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginVertical: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  trustItem: { flex: 1, alignItems: 'center', gap: 4 },
  trustValue: { fontSize: 18, fontWeight: '800', color: Colors.text },
  trustLabel: { fontSize: 12, color: Colors.textSecondary },
  section: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  muted: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  listingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  listingMain: { flex: 1 },
  listingTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  listingSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  listingActions: { gap: 6, alignItems: 'flex-end' },
  linkDone: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  linkCancel: { color: Colors.error, fontWeight: '600', fontSize: 13 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    padding: 14,
  },
  signOutText: { color: Colors.error, fontWeight: '700', fontSize: 15 },
});
