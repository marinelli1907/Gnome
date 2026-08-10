import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Package, HandHeart, LogOut, ChevronRight } from 'lucide-react-native';
import { Avatar, Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyProfile, useProfileStats } from '@/lib/db';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId, signOut } = useAuth();
  const profile = useMyProfile(userId ?? undefined);
  const stats = useProfileStats(userId ?? undefined);

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🧑‍🌾"
          title="Your Gnome profile"
          subtitle="Sign in to share surplus, claim items, and build neighborhood trust."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const memberSince = stats.data
    ? new Date(stats.data.memberSince).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : '—';

  return (
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={stats.isRefetching} onRefresh={() => stats.refetch()} tintColor={Colors.primary} />
      }
    >
      <View style={styles.headerCard}>
        <Avatar uri={profile.data?.avatar_url} name={profile.data?.name} size={64} />
        <Text style={styles.name}>{profile.data?.name ?? 'Neighbor'}</Text>
        {profile.data?.city ? (
          <Text style={styles.zip}>
            📍 {profile.data.city}{profile.data.state ? `, ${profile.data.state}` : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.trustRow}>
        <Trust icon={<CalendarDays size={18} color={Colors.primary} />} value={memberSince} label="Member since" />
        <Trust icon={<Package size={18} color={Colors.primary} />} value={String(stats.data?.postsShared ?? 0)} label="Shared" />
        <Trust icon={<HandHeart size={18} color={Colors.primary} />} value={String(stats.data?.claimsCompleted ?? 0)} label="Received" />
      </View>

      <Pressable
        style={styles.link}
        onPress={() => router.push('/profile/edit')}
        accessibilityRole="button"
        accessibilityLabel="Edit your profile"
      >
        <Text style={styles.linkText}>Edit profile & location</Text>
        <ChevronRight size={18} color={Colors.textSecondary} />
      </Pressable>

      <Pressable style={[styles.link, { marginTop: 10 }]} onPress={() => router.push('/activity')}>
        <Text style={styles.linkText}>Manage your listings & claims in My Gnome</Text>
        <ChevronRight size={18} color={Colors.textSecondary} />
      </Pressable>

      <Pressable
        style={[styles.link, { marginTop: 10 }]}
        onPress={() => router.push('/notebook')}
        accessibilityRole="button"
        accessibilityLabel="Sales notebook"
      >
        <Text style={styles.linkText}>Sales notebook</Text>
        <ChevronRight size={18} color={Colors.textSecondary} />
      </Pressable>

      <Pressable
        style={[styles.link, { marginTop: 10 }]}
        onPress={() => router.push('/compliance')}
        accessibilityRole="button"
        accessibilityLabel="Seller verification"
      >
        <Text style={styles.linkText}>Seller verification</Text>
        <ChevronRight size={18} color={Colors.textSecondary} />
      </Pressable>

      <Pressable style={[styles.link, { marginTop: 10 }]} onPress={() => router.push('/settings')}>
        <Text style={styles.linkText}>Settings, feedback & blocked neighbors</Text>
        <ChevronRight size={18} color={Colors.textSecondary} />
      </Pressable>

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: { alignItems: 'center', gap: 6, paddingVertical: 12 },
  name: { fontSize: 23, fontFamily: 'Fraunces_700Bold', color: Colors.text },
  zip: { fontSize: 14, color: Colors.textSecondary, fontFamily: fonts.regular },
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
  trustValue: { fontSize: 18, color: Colors.text, fontFamily: fonts.bold },
  trustLabel: { fontSize: 12, color: Colors.textSecondary, fontFamily: fonts.regular },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  linkText: { fontSize: 15, color: Colors.text, fontFamily: fonts.semibold },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    padding: 14,
  },
  signOutText: { color: Colors.error, fontSize: 15, fontFamily: fonts.bold },
});
