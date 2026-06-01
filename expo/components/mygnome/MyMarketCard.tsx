import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import Colors from '@/constants/colors';
import { useMarketListings, useMyMarket } from '@/lib/db';

export default function MyMarketCard({ uid }: { uid: string }) {
  const router = useRouter();
  const market = useMyMarket(uid);
  const listings = useMarketListings(market.data?.id);

  if (!market.data) {
    // Market is created on signup/backfill; if it's not there yet, stay quiet.
    return null;
  }

  const m = market.data;
  const count = listings.data?.length ?? 0;

  return (
    <View style={styles.card}>
      <Pressable style={styles.row} onPress={() => router.push(`/market/${m.id}`)}>
        <Avatar uri={m.avatar_url} name={m.name} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Your Market</Text>
          <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
          <Text style={styles.meta}>
            Free plan · {count} active listing{count === 1 ? '' : 's'} · unlimited for now
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.textTertiary} />
      </Pressable>
      <Pressable style={styles.editBtn} onPress={() => router.push(`/market/edit/${m.id}`)}>
        <Text style={styles.editText}>Name your garden</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 17, fontWeight: '800', color: Colors.text, marginTop: 1 },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  editBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  editText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
});
