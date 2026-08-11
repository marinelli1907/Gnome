// Order from a Market — buyer cart flow, pickup or delivery.
//
// Fulfillment: if the seller only offers one method the chooser disappears;
// with both, the buyer picks. Delivery shows the buyer's saved addresses (a
// private table only they can read), the server's authoritative quote
// (eligibility + fee — the client never does the math), and candidate
// windows the backend re-validates. No payment here — payment happens outside
// Gnome and is confirmed by the seller, delivery fee included.
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
import {
  deliveryWindows,
  useDeliveryQuote,
  useDeliverySettings,
  useMyAddresses,
  useSaveAddress,
  type DeliveryWindow,
} from '@/lib/delivery';

export default function MarketOrderScreen() {
  const { marketId } = useLocalSearchParams<{ marketId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(marketId);
  const listings = useMarketListings(marketId);
  const slots = usePickupSlots(marketId);
  const delivery = useDeliverySettings(marketId);
  const createOrder = useCreateOrder(userId ?? undefined);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [slot, setSlot] = useState<PickupSlot | null>(null);
  const [note, setNote] = useState('');

  const offersSettled = !slots.isLoading && !delivery.isLoading;
  const pickupOffered = (slots.data?.length ?? 0) > 0;
  const deliveryOffered = !!delivery.data?.enabled;
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery' | null>(null);
  // Only one method → no chooser. Auto-resolve only once BOTH queries settled,
  // or the selector flashes resolved → chooser as the second answer lands.
  const effectiveFulfillment: 'pickup' | 'delivery' | null =
    fulfillment ?? (!offersSettled ? null
      : pickupOffered && !deliveryOffered ? 'pickup'
      : deliveryOffered && !pickupOffered ? 'delivery'
      : null);

  // Delivery bits
  const addresses = useMyAddresses(userId ?? undefined);
  const [addressId, setAddressId] = useState<string | null>(null);
  const effectiveAddressId =
    addressId ?? addresses.data?.find((a) => a.is_default)?.id ?? addresses.data?.[0]?.id ?? null;
  const quote = useDeliveryQuote(
    effectiveFulfillment === 'delivery' ? marketId : undefined,
    effectiveAddressId,
  );
  const [dWindow, setDWindow] = useState<DeliveryWindow | null>(null);
  const dWindows = useMemo(
    () => (delivery.data && deliveryOffered ? deliveryWindows(delivery.data) : []),
    [delivery.data, deliveryOffered],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [newAddr, setNewAddr] = useState({ label: 'Home', address_line: '', city: '', state: 'OH', postal_code: '', delivery_notes: '' });
  const saveAddress = useSaveAddress(userId ?? undefined);

  const saleItems = useMemo(
    () => (listings.data ?? []).filter((l) => l.listing_type === 'sale' && l.price_cents != null),
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
  const deliveryFee = effectiveFulfillment === 'delivery' ? quote.data?.total_fee_cents ?? null : null;

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🧺" title="Sign in to order" subtitle="Orders are tied to your account.">
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

  const submitAddress = () => {
    if (!newAddr.address_line.trim()) {
      Alert.alert('Missing address', 'Enter the street address.');
      return;
    }
    saveAddress.mutate(
      {
        label: newAddr.label.trim() || 'Home',
        address_line: newAddr.address_line.trim(),
        city: newAddr.city.trim() || null,
        state: newAddr.state.trim().toUpperCase() || null,
        postal_code: newAddr.postal_code.trim() || null,
        delivery_notes: newAddr.delivery_notes.trim() || null,
        is_default: (addresses.data?.length ?? 0) === 0,
      },
      {
        onSuccess: (id) => {
          setAddressId(id);
          setAddOpen(false);
          setNewAddr({ label: 'Home', address_line: '', city: '', state: 'OH', postal_code: '', delivery_notes: '' });
        },
        onError: (e: any) => Alert.alert('Couldn’t save address', e?.message ?? 'Try again.'),
      },
    );
  };

  const submit = async () => {
    if (lines.length === 0) {
      Alert.alert('Nothing in your basket', 'Add at least one item first.');
      return;
    }
    const isDelivery = effectiveFulfillment === 'delivery';
    if (!isDelivery && !slot) {
      Alert.alert('Pick a time', 'Choose a pickup window for your order.');
      return;
    }
    if (isDelivery) {
      if (!effectiveAddressId) { Alert.alert('Add an address', 'Where should this be delivered?'); return; }
      if (!quote.data?.eligible) { Alert.alert('Delivery unavailable', reasonText(quote.data?.reason)); return; }
      if (!dWindow) { Alert.alert('Pick a day', 'Choose a delivery day for your order.'); return; }
    }
    try {
      const orderId = await createOrder.mutateAsync({
        marketId: marketId as string,
        lines,
        slot: isDelivery
          ? { slot_start: dWindow!.slot_start, slot_end: dWindow!.slot_end }
          : (slot as PickupSlot),
        note: note.trim() || null,
        fulfillment: isDelivery ? 'delivery' : 'pickup',
        addressId: isDelivery ? effectiveAddressId : null,
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
      } else if (/DELIVERY_INELIGIBLE|OUT_OF_RANGE/i.test(msg)) {
        Alert.alert('Delivery unavailable', 'Outside this Market’s delivery area.');
      } else if (/CUTOFF_PASSED|SAME_DAY_UNAVAILABLE|NEXT_DAY_UNAVAILABLE|NOT_A_DELIVERY_DAY|ORDER_BY_PASSED/i.test(msg)) {
        setDWindow(null);
        Alert.alert('That day won’t work', msg.split(':').slice(1).join(':').trim() || 'Pick another delivery day.');
      } else if (/DELIVERY_RESTRICTED/i.test(msg)) {
        Alert.alert('Pickup only', 'An item in this order can’t be delivered — order it for pickup instead.');
      } else if (/EMPTY_ORDER/i.test(msg)) {
        Alert.alert('Nothing in your basket', 'Add at least one item first.');
      } else {
        Alert.alert('Couldn’t place the order', msg || 'Check your connection and try again.');
      }
    }
  };

  const showChooser = pickupOffered && deliveryOffered;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          {market.data?.name ? `Order from ${market.data.name}` : 'Order'} — pick your
          items, choose how you’ll get them, and the seller confirms.
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

        {/* Fulfillment */}
        {showChooser && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>How would you like to get your order?</Text>
            <View style={styles.fulfillRow}>
              <Pressable
                onPress={() => setFulfillment('pickup')}
                accessibilityRole="button"
                accessibilityState={{ selected: effectiveFulfillment === 'pickup' }}
                style={[styles.fulfillCard, effectiveFulfillment === 'pickup' && styles.fulfillCardActive]}
              >
                <Text style={styles.fulfillEmoji}>🧺</Text>
                <Text style={styles.fulfillTitle}>Pick up</Text>
                <Text style={styles.fulfillSub}>Choose a pickup spot and time</Text>
              </Pressable>
              <Pressable
                onPress={() => setFulfillment('delivery')}
                accessibilityRole="button"
                accessibilityState={{ selected: effectiveFulfillment === 'delivery' }}
                style={[styles.fulfillCard, effectiveFulfillment === 'delivery' && styles.fulfillCardActive]}
              >
                <Text style={styles.fulfillEmoji}>🚚</Text>
                <Text style={styles.fulfillTitle}>Delivery</Text>
                <Text style={styles.fulfillSub}>Delivered by the seller</Text>
              </Pressable>
            </View>
          </>
        )}
        {!pickupOffered && !deliveryOffered && offersSettled && (
          <Text style={[styles.noneText, { marginTop: 16 }]}>
            This Market hasn’t set up ordering yet — message the seller from a listing instead.
          </Text>
        )}

        {/* Pickup path */}
        {effectiveFulfillment === 'pickup' && (
          <>
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
          </>
        )}

        {/* Delivery path */}
        {effectiveFulfillment === 'delivery' && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Deliver to</Text>
            {(addresses.data ?? []).map((a) => (
              <Pressable
                key={a.id}
                onPress={() => setAddressId(a.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: effectiveAddressId === a.id }}
                style={[styles.addrRow, effectiveAddressId === a.id && styles.addrRowActive]}
              >
                <Text style={styles.addrLabel}>{a.label}</Text>
                <Text style={styles.addrLine} numberOfLines={1}>
                  {a.address_line}{a.city ? `, ${a.city}` : ''}
                </Text>
              </Pressable>
            ))}
            {!addOpen ? (
              <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" style={styles.addAddrBtn}>
                <Text style={styles.addAddrText}>+ Add an address</Text>
              </Pressable>
            ) : (
              <View style={styles.addrForm}>
                <Field label="Label" value={newAddr.label} onChangeText={(t) => setNewAddr({ ...newAddr, label: t })} placeholder="Home / Work" />
                <Field label="Street address" value={newAddr.address_line} onChangeText={(t) => setNewAddr({ ...newAddr, address_line: t })} placeholder="Street address" />
                <View style={styles.pair}>
                  <View style={{ flex: 1.4 }}>
                    <Field label="City" value={newAddr.city} onChangeText={(t) => setNewAddr({ ...newAddr, city: t })} placeholder="City" />
                  </View>
                  <View style={{ flex: 0.6 }}>
                    <Field label="State" value={newAddr.state} onChangeText={(t) => setNewAddr({ ...newAddr, state: t })} autoCapitalize="characters" maxLength={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="ZIP" value={newAddr.postal_code} onChangeText={(t) => setNewAddr({ ...newAddr, postal_code: t })} placeholder="ZIP code" keyboardType="number-pad" maxLength={5} />
                  </View>
                </View>
                <Field label="Delivery notes (optional)" value={newAddr.delivery_notes} onChangeText={(t) => setNewAddr({ ...newAddr, delivery_notes: t })} placeholder="Gate code, porch, dog…" />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button label={saveAddress.isPending ? 'Saving…' : 'Save address'} onPress={submitAddress} disabled={saveAddress.isPending} style={{ flex: 1 }} />
                  <Button label="Cancel" variant="secondary" onPress={() => setAddOpen(false)} style={{ flex: 1 }} />
                </View>
              </View>
            )}

            {/* Quote */}
            {effectiveAddressId && quote.data && (
              quote.data.eligible ? (
                <View style={styles.quoteBox}>
                  <Text style={styles.quoteLine}>
                    🚚 {quote.data.distance_miles} mi · delivery {money(quote.data.total_fee_cents ?? 0)}
                    {quote.data.surcharge_cents ? ` (incl. ${money(quote.data.surcharge_cents)} distance fee)` : ''}
                  </Text>
                </View>
              ) : (
                <View style={styles.quoteBoxBad}>
                  <Text style={styles.quoteLineBad}>{reasonText(quote.data.reason)}</Text>
                </View>
              )
            )}

            {/* Delivery day */}
            {quote.data?.eligible && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Delivery day</Text>
                <View style={styles.chips}>
                  {dWindows.map((w) => (
                    <Pressable
                      key={w.slot_start}
                      onPress={() => setDWindow(w)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: dWindow?.slot_start === w.slot_start }}
                      style={[styles.chip, dWindow?.slot_start === w.slot_start && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, dWindow?.slot_start === w.slot_start && styles.chipTextActive]}>
                        {w.label}
                      </Text>
                    </Pressable>
                  ))}
                  {dWindows.length === 0 && (
                    <Text style={styles.noneText}>No delivery days available right now — check back tomorrow.</Text>
                  )}
                </View>
                <Text style={styles.hint}>The seller confirms the exact time with you.</Text>
              </>
            )}
          </>
        )}

        {lines.length > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {deliveryFee != null ? `Items ${money(totalCents)} + delivery ${money(deliveryFee)}` : 'Estimated total'}
            </Text>
            <Text style={styles.totalValue}>{money(totalCents + (deliveryFee ?? 0))}</Text>
          </View>
        ) : null}

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
          label={effectiveFulfillment === 'delivery' ? 'Request Delivery' : 'Request Pickup'}
          onPress={() => void submit()}
          loading={createOrder.isPending}
          disabled={
            lines.length === 0 ||
            (effectiveFulfillment === 'pickup' && !slot) ||
            (effectiveFulfillment === 'delivery' && (!quote.data?.eligible || !dWindow)) ||
            effectiveFulfillment === null
          }
        />
        <Text style={styles.footNote}>
          No payment is taken here — you pay the seller directly, delivery fee included.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function reasonText(reason?: string | null): string {
  if (!reason) return 'Delivery isn’t available for this address.';
  if (reason.startsWith('OUT_OF_RANGE')) return 'Outside this Market’s delivery area.';
  if (reason.startsWith('PICKUP_ONLY')) return 'This Market currently offers pickup only.';
  if (reason.startsWith('ADDRESS_NOT_LOCATED')) return 'We couldn’t place that address on the map — edit and re-save it.';
  if (reason.startsWith('NO_ORIGIN')) return 'This Market hasn’t set a delivery starting point yet.';
  return reason.split(':').slice(1).join(':').trim() || reason;
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
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnText: { fontSize: 20, fontFamily: fonts.bold, color: Colors.primary, lineHeight: 24 },
  stepCount: { minWidth: 28, textAlign: 'center', fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  fulfillRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  fulfillCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: Colors.borderLight, alignItems: 'flex-start',
  },
  fulfillCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0A' },
  fulfillEmoji: { fontSize: 22 },
  fulfillTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text, marginTop: 6 },
  fulfillSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  addrRow: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginTop: 8,
    borderWidth: 1.5, borderColor: Colors.borderLight,
  },
  addrRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0A' },
  addrLabel: { fontSize: 13, fontFamily: fonts.bold, color: Colors.primary },
  addrLine: { fontSize: 14, fontFamily: fonts.regular, color: Colors.text, marginTop: 2 },
  addAddrBtn: { marginTop: 10, paddingVertical: 8 },
  addAddrText: { fontSize: 14, fontFamily: fonts.bold, color: Colors.primary },
  addrForm: { marginTop: 10 },
  pair: { flexDirection: 'row', gap: 10 },
  quoteBox: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  quoteBoxBad: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: Colors.error,
  },
  quoteLine: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.text },
  quoteLineBad: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.error },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  hint: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 8 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 16, paddingHorizontal: 4,
  },
  totalLabel: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary, flex: 1, marginRight: 10 },
  totalValue: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text },
  slotSummary: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.primary, marginTop: 10 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  footNote: {
    fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary,
    textAlign: 'center', marginTop: 12, lineHeight: 16,
  },
});
