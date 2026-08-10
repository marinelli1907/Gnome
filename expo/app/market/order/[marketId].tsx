// Order for pickup — buyer cart flow. Pick items from a market's active sale
// listings, pick WHERE you're collecting them (only the spots that can fulfil
// the whole basket), then a slot at that spot, add a note, and request.
// Deliberately simple: no checkout, no payment — payment happens outside Gnome
// and is confirmed by the seller.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, Field } from '@/components/ui';
import SlotPicker from '@/components/orders/SlotPicker';
import PickupLocationPicker, {
  locationDistanceLabel,
} from '@/components/pickup-buyer/PickupLocationPicker';
import PickupConflictNotice from '@/components/pickup-buyer/PickupConflictNotice';
import { locationTypeEmoji, locationTypeLabel } from '@/components/pickup-buyer/labels';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useMarketListings } from '@/lib/db';
import { getCoordsIfGranted, type Coords } from '@/lib/location';
import {
  fmtWindow,
  money,
  useCartPickupLocations,
  useCreateOrder,
  useLocationSlots,
  type CartLine,
  type PickupSlot,
} from '@/lib/marketops';

export default function MarketOrderScreen() {
  const { marketId } = useLocalSearchParams<{ marketId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(marketId);
  const listings = useMarketListings(marketId);
  const createOrder = useCreateOrder(userId ?? undefined);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [slot, setSlot] = useState<PickupSlot | null>(null);
  const [note, setNote] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [myCoords, setMyCoords] = useState<Coords | null>(null);

  // Passive fix only — the cart never prompts for location just to show "2 mi".
  useEffect(() => {
    void getCoordsIfGranted().then(setMyCoords);
  }, []);

  const saleItems = useMemo(
    () =>
      (listings.data ?? []).filter(
        (l) => l.listing_type === 'sale' && l.price_cents != null,
      ),
    [listings.data],
  );

  const lines: CartLine[] = useMemo(
    () =>
      saleItems
        .filter((l) => (qty[l.id] ?? 0) > 0)
        .map((l) => ({
          listingId: l.id,
          title: l.title,
          unit: l.unit,
          priceCents: l.price_cents as number,
          quantity: qty[l.id],
          inventory: l.inventory_count,
        })),
    [saleItems, qty],
  );

  const totalCents = lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);

  // Where this exact basket can be collected. Recomputed by the server whenever
  // the basket changes — a location only qualifies if it fulfils EVERY line.
  const listingIds = useMemo(() => lines.map((l) => l.listingId), [lines]);
  const cartLocs = useCartPickupLocations(marketId, listingIds);
  const locs = useMemo(() => cartLocs.data ?? [], [cartLocs.data]);
  const locKey = locs.map((l) => l.location_id).join(',');
  const hasItems = listingIds.length > 0;
  // An empty array is a real answer from the RPC, not a loading state.
  const noSharedLocation = hasItems && cartLocs.isSuccess && locs.length === 0;

  // Keep the selection valid as the basket narrows: one option selects itself,
  // several default to the seller's usual spot, and a spot that dropped out of
  // the list is cleared rather than silently submitted.
  useEffect(() => {
    if (!locs.length) {
      setLocationId(null);
      return;
    }
    setLocationId((current) => {
      if (current && locs.some((l) => l.location_id === current)) return current;
      if (locs.length === 1) return locs[0].location_id;
      return locs.find((l) => l.is_default)?.location_id ?? null;
    });
  }, [locKey, locs]);

  // Slots belong to a location — changing where you collect invalidates when.
  useEffect(() => {
    setSlot(null);
  }, [locationId]);

  const slots = useLocationSlots(locationId, 10);
  const chosenLoc = locs.find((l) => l.location_id === locationId) ?? null;

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🧺" title="Sign in to order" subtitle="Pickup orders are tied to your account.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (listings.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState message="Couldn’t load this market’s items." onRetry={() => listings.refetch()} />
      </View>
    );
  }

  const step = (id: string, delta: number, cap: number | null) => {
    setQty((prev) => {
      const current = prev[id] ?? 0;
      let next = current + delta;
      if (next < 0) next = 0;
      if (cap != null && next > cap) next = cap;
      return { ...prev, [id]: next };
    });
  };

  const submit = async () => {
    if (lines.length === 0) {
      Alert.alert('Nothing in your basket', 'Add at least one item first.');
      return;
    }
    if (!locationId) {
      Alert.alert('Pick a pickup spot', 'Choose where you’ll collect this order.');
      return;
    }
    if (!slot) {
      Alert.alert('Pick a time', 'Choose a pickup window for your order.');
      return;
    }
    try {
      const orderId = await createOrder.mutateAsync({
        marketId: marketId as string,
        lines,
        slot,
        note: note.trim() || null,
        locationId,
      });
      router.replace(`/order/${orderId}`);
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (/NO_COMMON_PICKUP_LOCATION/i.test(msg)) {
        void cartLocs.refetch();
        Alert.alert(
          'No shared pickup spot',
          'These items can’t all be picked up in the same place anymore. Adjust your basket and try again.',
        );
      } else if (/PICKUP_NOT_CONFIGURED/i.test(msg)) {
        void cartLocs.refetch();
        Alert.alert(
          'Pickup isn’t set up',
          'This seller hasn’t finished setting up pickup. Message them instead.',
        );
      } else if (/SLOT_UNAVAILABLE/i.test(msg)) {
        setSlot(null);
        void slots.refetch();
        Alert.alert('That time was just taken', 'Pick another pickup window.');
      } else if (/ITEM_UNAVAILABLE/i.test(msg)) {
        void listings.refetch();
        Alert.alert('Item no longer available', 'Something in your basket just sold out. Adjust your order and try again.');
      } else if (/EMPTY_ORDER/i.test(msg)) {
        Alert.alert('Nothing in your basket', 'Add at least one item first.');
      } else {
        Alert.alert('Couldn’t request pickup', msg || 'Check your connection and try again.');
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          {market.data?.name ? `Order from ${market.data.name}` : 'Order for pickup'} — pick your
          items and a time, and the seller confirms.
        </Text>

        {/* Items */}
        <Text style={styles.sectionTitle}>Items</Text>
        {saleItems.length === 0 && !listings.isLoading ? (
          <Text style={styles.noneText}>Nothing is for sale here right now.</Text>
        ) : (
          saleItems.map((l) => {
            const q = qty[l.id] ?? 0;
            const soldOut = l.inventory_count != null && l.inventory_count <= 0;
            const atCap = l.inventory_count != null && q >= l.inventory_count;
            return (
              <View key={l.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{l.title}</Text>
                  <Text style={styles.itemSub}>
                    {money(l.price_cents as number)}
                    {l.unit ? ` / ${l.unit}` : ''}
                    {l.inventory_count != null ? ` · ${l.inventory_count} left` : ''}
                  </Text>
                </View>
                {soldOut ? (
                  <Text style={styles.soldOut}>Sold out</Text>
                ) : (
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => step(l.id, -1, l.inventory_count)}
                      disabled={q === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove one ${l.title}`}
                      style={[styles.stepBtn, q === 0 && styles.stepBtnDisabled]}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </Pressable>
                    <Text style={styles.stepCount} accessibilityLabel={`${q} of ${l.title} in basket`}>
                      {q}
                    </Text>
                    <Pressable
                      onPress={() => step(l.id, 1, l.inventory_count)}
                      disabled={atCap}
                      accessibilityRole="button"
                      accessibilityLabel={`Add one ${l.title}`}
                      style={[styles.stepBtn, atCap && styles.stepBtnDisabled]}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}

        {lines.length > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Estimated total</Text>
            <Text style={styles.totalValue}>{money(totalCents)}</Text>
          </View>
        ) : null}

        {/* Pickup location — which spots can fulfil this exact basket */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Pickup location</Text>
        {!hasItems ? (
          <Text style={styles.noneText}>Add an item to see where you can collect it.</Text>
        ) : cartLocs.isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
        ) : cartLocs.isError ? (
          <ErrorState
            message="Couldn’t check pickup locations."
            onRetry={() => cartLocs.refetch()}
          />
        ) : noSharedLocation ? (
          <PickupConflictNotice
            marketId={marketId}
            lines={lines.map((l) => ({ listingId: l.listingId, title: l.title }))}
          />
        ) : locs.length === 1 ? (
          <View
            style={styles.singleLocCard}
            accessibilityLabel={`Pickup at ${locs[0].nickname}, ${locationTypeLabel(
              locs[0].location_type,
            )}`}
          >
            <Text style={styles.singleLocEmoji}>{locationTypeEmoji(locs[0].location_type)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.singleLocName} numberOfLines={1}>
                Pickup at {locs[0].nickname}
              </Text>
              <Text style={styles.singleLocMeta}>
                {locationTypeLabel(locs[0].location_type)}
                {locationDistanceLabel(myCoords, locs[0])
                  ? ` · ${locationDistanceLabel(myCoords, locs[0])}`
                  : ''}
              </Text>
            </View>
          </View>
        ) : (
          <PickupLocationPicker
            locations={locs}
            selectedId={locationId}
            onSelect={setLocationId}
            coords={myCoords}
          />
        )}

        {/* Pickup time — always for the CHOSEN location */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Pickup time</Text>
        {!locationId ? (
          <Text style={styles.noneText}>
            {noSharedLocation
              ? 'Pick a basket that shares one pickup spot to see times.'
              : hasItems
                ? 'Choose a pickup location to see available times.'
                : 'Add an item to see available times.'}
          </Text>
        ) : (
          <>
            <SlotPicker
              slots={slots.data ?? []}
              loading={slots.isLoading}
              isError={slots.isError}
              onRetry={() => slots.refetch()}
              selected={slot}
              onSelect={setSlot}
            />
            {slot ? (
              <Text style={styles.slotSummary}>
                Pickup {fmtWindow(slot.slot_start, slot.slot_end)}
                {chosenLoc ? ` at ${chosenLoc.nickname}` : ''}
              </Text>
            ) : null}
          </>
        )}

        {/* Note */}
        <View style={{ marginTop: 20 }}>
          <Field
            label="Note to the seller (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Anything they should know?"
            multiline
            numberOfLines={2}
            style={styles.multiline}
            maxLength={300}
          />
        </View>

        <Button
          label="Request Pickup"
          onPress={() => void submit()}
          loading={createOrder.isPending}
          disabled={lines.length === 0 || !slot || !locationId || noSharedLocation}
        />
        <Text style={styles.footNote}>
          No payment is taken here — you pay the seller directly at (or before) pickup.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 14, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginBottom: 4 },
  noneText: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 6 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  itemTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  itemSub: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  soldOut: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.textTertiary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnText: { fontSize: 20, fontFamily: fonts.bold, color: Colors.primary, lineHeight: 24 },
  stepCount: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: fonts.bold,
    color: Colors.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 4,
  },
  totalLabel: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  totalValue: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text },
  slotSummary: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.primary, marginTop: 10 },
  singleLocCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  singleLocEmoji: { fontSize: 18, fontFamily: fonts.regular },
  singleLocName: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  singleLocMeta: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  footNote: {
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },
});
