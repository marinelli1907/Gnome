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
import ActivityFeed from '@/components/mygnome/ActivityFeed';

type Tab = 'claims' | 'listings' | 'pickups' | 'messages' | 'activity';

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
    { key: 'activity', label: 'Activity' },
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
      <Text style={styles.h1}>My Gnome</Text>

      <MyMarketCard uid={userId} />
      <BuildMarketCard />
      <ShareMarketCard uid={userId} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segRow}
        contentContainerStyle={styles.segRowContent}
      >
        {SEGMENTS.map((s) => {
          const active = tab === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => setTab(s.key)}
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
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {tab === 'claims' && <ClaimsToReview uid={userId} />}
        {tab === 'listings' && <MyListingsView uid={userId} />}
        {tab === 'pickups' && <MyPickups uid={userId} />}
        {tab === 'messages' && <MessagesView uid={userId} chats={chats} reads={reads} />}
        {tab === 'activity' && <ActivityFeed uid={userId} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  h1: { fontSize: 28, fontFamily: fonts.displayBlack, color: Colors.text, paddingHorizontal: 16, paddingTop: 6 },
  segRow: { marginTop: 10, flexGrow: 0 },
  segRowContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 6 },
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
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
  badgeText: { color: '#fff', fontSize: 11, fontFamily: fonts.bold },
  body: { padding: 16, paddingBottom: 40 },
});
