import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, EmptyState } from '@/components/ui';
import ListingCard from '@/components/ListingCard';
import Colors from '@/constants/colors';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useMarketListings } from '@/lib/db';

export default function MarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(id);
  const listings = useMarketListings(id);

  if (market.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (market.error) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="⚠️" title="Couldn't load this garden" subtitle="Please try again in a moment." />
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
        numColumns={2}
        ListHeaderComponent={Header}
        columnWrapperStyle={styles.row}
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
  name: { fontSize: 24, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  desc: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 2 },
  countLine: { fontSize: 13, color: Colors.textTertiary, marginTop: 14, fontWeight: '600' },
  row: { paddingHorizontal: 12, gap: 12 },
  cardWrap: { flex: 1, marginBottom: 12 },
});
