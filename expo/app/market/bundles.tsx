// Gift Baskets — seller management (0121). A basket is ONE sellable offer
// composed of the seller's EXISTING listings ("Sunday Breakfast Basket").
// Creation goes through the canonical create_market_bundle RPC (the same one
// the AI's confirm path uses). A basket is a normal Sell listing: publishing
// consumes one Sell publish, it runs 7 days, and it renews like anything
// else. It is available only while every item inside it is available.
import React, { useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TextInput, View, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket, useMyBundles, useCreateBundle, useMarketListings } from '@/lib/db';

const price = (c: number | null) =>
  c == null ? '' : `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

export default function MarketBundlesScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;

  const bundles = useMyBundles(marketId);
  const listings = useMarketListings(marketId);
  const createBundle = useCreateBundle(userId ?? undefined);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [inventory, setInventory] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const candidates = (listings.data ?? []).filter(
    (l) => l.listing_type === 'sale' && !l.is_bundle,
  );

  const create = () => {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    const cents = Math.round(parseFloat(priceText || '0') * 100);
    if (!title.trim()) { Alert.alert('Gift Basket', 'Give the basket a name.'); return; }
    if (!Number.isFinite(cents) || cents < 1) { Alert.alert('Gift Basket', 'Set one price for the whole basket.'); return; }
    if (ids.length < 2) { Alert.alert('Gift Basket', 'Pick at least two of your listings.'); return; }
    const inv = inventory.trim() ? parseInt(inventory, 10) : null;
    createBundle.mutate(
      { title: title.trim(), priceCents: cents, componentIds: ids,
        description: description.trim() || null, inventory: inv && inv > 0 ? inv : null },
      {
        onSuccess: (r) => {
          setCreating(false);
          setTitle(''); setDescription(''); setPriceText(''); setInventory(''); setPicked({});
          Alert.alert('Gift Basket', `“${r.title}” is live with ${r.items} items inside.`);
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : '';
          Alert.alert('Gift Basket',
            /PUBLISH_ALLOWANCE_EXHAUSTED/.test(msg)
              ? 'Your plan’s Sell publishes are used up for this period. A basket publishes like any listing — grab a $0.99 extra publish from My Market on the web, or upgrade your plan.'
              : /BUNDLE_NEEDS_ITEMS/.test(msg) ? 'A basket needs at least two items.'
              : /BUNDLE_ITEM_LIMIT/.test(msg) ? 'A basket holds up to 12 items.'
              : /COMPONENT_NOT_AVAILABLE/.test(msg) ? 'One of those listings isn’t live right now.'
              : 'Couldn’t create the basket — check the details and try again.');
        },
      },
    );
  };

  if (!userId || (market.data === null && !market.isLoading)) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🎁" title="No Market yet" subtitle="Post something first — your Market comes with your first listing." />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.intro}>
        Combine a few things you sell into one offer — “Sunday Breakfast Basket”.
        A basket is available only while all items inside it are available.
      </Text>

      {(bundles.data ?? []).length === 0 && !creating && (
        <EmptyState emoji="🎁" title="No baskets yet"
          subtitle="Bundle a few of your products into one ready-to-go offer." />
      )}

      {(bundles.data ?? []).map((b) => (
        <View key={b.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {b.title}{'  '}
            <Text style={styles.badge}>
              {b.status !== 'active' ? b.status : b.available ? 'available' : 'unavailable'}
            </Text>
          </Text>
          <Text style={styles.cardMeta}>
            {price(b.price_cents)}
            {b.inventory_count != null ? ` · ${b.inventory_count} left` : ''}
            {' · '}{b.components.length} items: {b.components.join(', ')}
          </Text>
          {!b.available && b.status === 'active' && (
            <Text style={styles.cardMeta}>An item inside is spoken for — the basket is hidden until it’s back.</Text>
          )}
        </View>
      ))}

      {!creating ? (
        <Button label="+ New Gift Basket" onPress={() => setCreating(true)} style={{ marginTop: 14 }} />
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Basket name</Text>
          <TextInput style={styles.input} placeholder="Sunday Breakfast Basket" placeholderTextColor={Colors.textTertiary}
            value={title} onChangeText={setTitle} maxLength={80} />
          <Text style={styles.label}>Short description (optional)</Text>
          <TextInput style={styles.input} placeholder="Eggs, sourdough and jam — Sunday sorted." placeholderTextColor={Colors.textTertiary}
            value={description} onChangeText={setDescription} maxLength={400} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Basket price ($)</Text>
              <TextInput style={styles.input} placeholder="25" placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad" value={priceText}
                onChangeText={(t) => setPriceText(t.replace(/[^0-9.]/g, ''))} />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>How many baskets can you assemble?</Text>
              <TextInput style={styles.input} placeholder="e.g. 3 (optional)" placeholderTextColor={Colors.textTertiary}
                keyboardType="number-pad" value={inventory}
                onChangeText={(t) => setInventory(t.replace(/[^0-9]/g, ''))} />
            </View>
          </View>
          <Text style={styles.label}>Pick what goes inside (at least two)</Text>
          {candidates.map((l) => (
            <Pressable key={l.id} style={styles.pickRow}
              onPress={() => setPicked((p) => ({ ...p, [l.id]: !p[l.id] }))}>
              <Text style={styles.pickBox}>{picked[l.id] ? '☑' : '☐'}</Text>
              <Text style={styles.pickTitle}>{l.title}</Text>
              <Text style={styles.pickPrice}>
                {price(l.price_cents)}{l.unit ? `/${l.unit}` : ''}
              </Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <Button label="Create basket" loading={createBundle.isPending} onPress={create} />
            <Pressable onPress={() => setCreating(false)} hitSlop={8}>
              <Text style={styles.cancel}>Close</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 16 },
  intro: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 14, fontFamily: fonts.regular },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 12, gap: 4,
    borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 10,
  },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: Colors.text },
  badge: { fontFamily: fonts.semibold, fontSize: 11, color: Colors.primary },
  cardMeta: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  form: { marginTop: 12, gap: 6 },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginTop: 8 },
  input: {
    borderWidth: 1.5, borderColor: Colors.borderLight, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    fontFamily: fonts.regular, color: Colors.text, backgroundColor: Colors.surface,
  },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  pickBox: { fontSize: 18, color: Colors.primary },
  pickTitle: { flex: 1, fontSize: 14, fontFamily: fonts.regular, color: Colors.text },
  pickPrice: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary },
  cancel: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
});
