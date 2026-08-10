// Order for pickup — buyer cart flow. Pick items from a market's active sale
// listings, choose a server-generated pickup slot, add a note, and request.
// Deliberately simple: no checkout, no payment — payment happens outside Gnome
// and is confirmed by the seller.
import React, { useMemo, useState } from 'react';
import {
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
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useMarketListings } from '@/lib/db';
import {
  fmtWindow,
  money,
  useCreateOrder,
  usePickupSlots,
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
  const slots = usePickupSlots(marketId);
  const createOrder = useCreateOrder(userId ?? undefined);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [slot, setSlot] = useState<PickupSlot | null>(null);
  const [note, setNote] = useState('');

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
      });
      router.replace(`/order/${orderId}`);
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (/SLOT_UNAVAILABLE/i.test(msg)) {
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

        {/* Pickup time */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Pickup time</Text>
        <SlotPicker
          slots={slots.data ?? []}
          loading={slots.isLoading}
          isError={slots.isError}
          onRetry={() => slots.refetch()}
          selected={slot}
          onSelect={setSlot}
        />
        {slot ? <Text style={styles.slotSummary}>Pickup {fmtWindow(slot.slot_start, slot.slot_end)}</Text> : null}

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
          disabled={lines.length === 0 || !slot}
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
