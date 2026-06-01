import React, { useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, EmptyState, ErrorState } from '@/components/ui';
import { FeedSkeleton } from '@/components/Skeleton';
import ListingCard from '@/components/ListingCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useMarketListings, logEvent } from '@/lib/db';

export default function MarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(id);
  const listings = useMarketListings(id);

  useEffect(() => {
    if (market.data) {
      void logEvent('market_viewed', { userId: userId ?? null, metadata: { market_id: market.data.id } });
    }
  }, [market.data?.id, userId]);

  if (market.isLoading) {
    return (
      <View style={styles.screen}>
        <FeedSkeleton count={3} />
      </View>
    );
  }
  if (market.error) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState
          title="Couldn’t load this garden"
          message="Check your connection and try again."
          onRetry={() => market.refetch()}
        />
      </View>
    );
  }
  if (!market.data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🏡" title="Garden not found" subtitle="This Market may no longer be active." />
      </View>
    );
  }

  const m = market.data;
  const isOwner = userId === m.owner_id;
  const items = listings.data ?? [];

  const Header = (
    <View style={styles.header}>
      <Avatar uri={m.avatar_url} name={m.name} size={72} />
      <Text style={styles.name}>{m.name}</Text>
      {m.description ? <Text style={styles.desc}>{m.description}</Text> : null}
      {isOwner && (
        <Button
          label="Name your garden"
          variant="secondary"
          onPress={() => router.push(`/market/edit/${m.id}`)}
          style={{ marginTop: 12, alignSelf: 'center', paddingHorizontal: 28 }}
        />
      )}
      <Text style={styles.countLine}>
        {items.length} active listing{items.length === 1 ? '' : 's'}
      </Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top ? 0 : 0 }]}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={
          listings.isLoading ? null : (
            <EmptyState
              emoji="🌱"
              title="Nothing growing here yet"
              subtitle={isOwner ? 'Share something from the Post tab to fill your garden.' : 'Check back soon.'}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 32 },
  header: { alignItems: 'center', padding: 20, gap: 6 },
  name: { fontSize: 24, fontFamily: fonts.bold, color: Colors.text, textAlign: 'center' },
  desc: { fontSize: 15, fontFamily: fonts.regular, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 2 },
  countLine: { fontSize: 13, color: Colors.textTertiary, marginTop: 14, fontFamily: fonts.semibold },
  cardWrap: { paddingHorizontal: 16 },
});
