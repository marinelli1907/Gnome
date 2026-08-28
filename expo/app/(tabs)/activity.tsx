import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CreditCard } from 'lucide-react-native';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useIncomingClaims, useMyChats } from '@/lib/db';
import { isUnread, useChatReads } from '@/lib/chatReads';
import MyMarketCard from '@/components/mygnome/MyMarketCard';
import ShareMarketCard from '@/components/mygnome/ShareMarketCard';
import BuildMarketCard from '@/components/mygnome/BuildMarketCard';
import ClaimsToReview from '@/components/mygnome/ClaimsToReview';
import MyListingsView from '@/components/mygnome/MyListingsView';
import MyPickups from '@/components/mygnome/MyPickups';
import MessagesView from '@/components/mygnome/MessagesView';

type Tab = 'claims' | 'listings' | 'pickups' | 'messages';

export default function MyGnomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [tab, setTab] = useState<Tab>('claims');

  // Shared data for the badge counts + Messages view.
  const incoming = useIncomingClaims(userId ?? undefined);
  const chatsQ = useMyChats(userId ?? undefined);
  const { reads, reload } = useChatReads();

  // Refresh local read-state whenever this tab regains focus (e.g. after a chat).
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🏡"
          title="Your Gnome home base"
          subtitle="Sign in to review claims, manage what you've shared, and message neighbors."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const chats = chatsQ.data ?? [];
  const pendingCount = (incoming.data ?? []).filter((c) => c.status === 'pending').length;
  const unreadCount = chats.filter((c) => isUnread(c, userId, reads)).length;

  const SEGMENTS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'claims', label: 'Requests', badge: pendingCount },
    { key: 'listings', label: 'Listings' },
    { key: 'pickups', label: 'Pickups' },
    { key: 'messages', label: 'Messages', badge: unreadCount },
  ];

  const onRefresh = () => {
    void reload();
    ['incomingClaims', 'myListings', 'myClaims', 'myChats', 'myEvents'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  };
  const refreshing =
    incoming.isRefetching || chatsQ.isRefetching;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 104 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.marketOrangeInteractive} />
        }
      >
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Market</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View and upgrade your plan"
            onPress={() => router.push('/upgrade')}
            style={styles.planButton}
          >
            <CreditCard size={17} color={Colors.primaryDark} />
            <Text style={styles.planButtonText}>Plans</Text>
          </Pressable>
        </View>
        <MyMarketCard uid={userId} />
        <BuildMarketCard />
        <ShareMarketCard uid={userId} />

        <View style={styles.segShell}>
          {SEGMENTS.map((s) => {
            const active = tab === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => setTab(s.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.seg, active && styles.segActive]}
              >
                <Text style={[styles.segText, active && styles.segTextActive]}>{s.label}</Text>
                {s.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{s.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sectionBody}>
          {tab === 'claims' && <ClaimsToReview uid={userId} />}
          {tab === 'listings' && <MyListingsView uid={userId} />}
          {tab === 'pickups' && <MyPickups uid={userId} />}
          {tab === 'messages' && <MessagesView uid={userId} chats={chats} reads={reads} />}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6,
  },
  h1: { fontSize: 28, fontFamily: fonts.displayBlack, color: Colors.text },
  planButton: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 13, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.primary + '55', backgroundColor: Colors.primary + '0D',
  },
  planButtonText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.primaryDark },
  body: { paddingTop: 0 },
  segShell: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 4,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  seg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  // Market is orange. White on this cut measures 5.18:1.
  segActive: { backgroundColor: Colors.marketOrangeInteractive, borderColor: Colors.marketOrangeInteractive },
  segText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  segTextActive: { color: Colors.textInverse },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Harvest Yellow NEVER takes a white label — that pairing is 1.63:1 and the
  // count was invisible. Charcoal on #FFC107 measures 9.76:1.
  badgeText: { color: Colors.text, fontSize: 11, fontFamily: fonts.bold },
  sectionBody: { padding: 16, paddingTop: 14 },
});
