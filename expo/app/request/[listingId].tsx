import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { categoryFor } from '@/constants/categories';
import { formatPrice } from '@/lib/listingType';
import { useAuth } from '@/providers/AuthProvider';
import { useClaimListing, useListing } from '@/lib/db';
import { METHOD_LABEL, money, useMarketPaymentMethods, usePickupSlots, type PaymentMethodKind } from '@/lib/marketops';
import { quantityEstimateLabel } from '@/lib/quantityEstimate';
import { pickedDateLabel } from '@/lib/harvestDate';
import { parseServerError } from '@/lib/taxonomy';
import type { ClaimType, ListingType } from '@/types';

const FALLBACK_PAYMENT_METHODS: PaymentMethodKind[] = ['cash'];

export default function RequestScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading, error } = useListing(listingId);
  const payMethods = useMarketPaymentMethods(listing?.market_id ?? undefined);
  const pickupSlots = usePickupSlots(listing?.market_id ?? undefined, 7);
  const claim = useClaimListing(userId ?? undefined);

  const [tradeOffer, setTradeOffer] = useState('');
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodKind>('cash');
  const [pickupSlot, setPickupSlot] = useState<{ slot_start: string; slot_end: string } | null>(null);
  // Structured choice for Wanted/Plot listings that define options.
  const [picked, setPicked] = useState<{ label: string; node_id?: string | null } | null>(null);
  const [pickedCustom, setPickedCustom] = useState(false);

  if (isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="⚠️" title="Couldn't load this listing" subtitle="Please try again." />
      </View>
    );
  }
  if (!listing) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🥕" title="Listing not found" subtitle="It may have expired or been removed." />
      </View>
    );
  }
  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in first" subtitle="You need an account to make a request.">
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (listing.owner_id === userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🙂" title="This is your listing" subtitle="You can't request your own listing." />
      </View>
    );
  }

  const type: ListingType = listing.listing_type ?? (listing.kind === 'wanted' ? 'wanted' : 'free');
  const cat = categoryFor(listing.category);
  const available = listing.inventory_count;
  const unitPrice = listing.price_cents ?? null;
  const estimatedTotal = unitPrice != null ? unitPrice * quantity : null;
  const quantityEstimate = type === 'sale'
    ? quantityEstimateLabel({
        unit: listing.unit,
        quantityText: listing.quantity,
        title: listing.title,
        count: quantity,
      })
    : null;
  const pickedLabel = pickedDateLabel(listing.harvest_date);
  const enabledPaymentMethods = (payMethods.data ?? [])
    .filter((m) => m.enabled)
    .map((m) => m.method);
  const paymentChoices = enabledPaymentMethods.length > 0 ? enabledPaymentMethods : FALLBACK_PAYMENT_METHODS;
  const chosenPayment = paymentChoices.includes(paymentMethod) ? paymentMethod : paymentChoices[0];
  const marketArea = [
    listing.owner?.city,
    listing.owner?.state,
  ].filter(Boolean).join(', ');
  const firstSlots = pickupSlots.data?.slice(0, 4) ?? [];

  const stepQuantity = (delta: number) => {
    setQuantity((q) => {
      const cap = available ?? 99;
      return Math.max(1, Math.min(cap, q + delta));
    });
  };

  const config: Record<ListingType, { heading: string; cta: string; claimType: ClaimType }> = {
    free: { heading: `Claim "${listing.title}"`, cta: 'Send claim', claimType: 'claim' },
    trade: { heading: `Offer a trade for "${listing.title}"`, cta: 'Send trade offer', claimType: 'trade_offer' },
    sale: { heading: `Reserve ${listing.title}`, cta: 'Request reservation', claimType: 'purchase_request' },
    wanted: { heading: `You have "${listing.title}"`, cta: 'Send', claimType: 'wanted_response' },
    plot: { heading: `Reserve "${listing.title}"`, cta: 'Send reservation request', claimType: 'plot_reservation' },
  };
  const c = config[type];

  const options = (listing.request_options ?? []) as { label: string; node_id?: string | null }[];
  const hasOptions = (type === 'wanted' || type === 'plot') && options.length > 0;
  const allowCustom = listing.allow_custom_request !== false;

  const submit = () => {
    if (type === 'trade' && !tradeOffer.trim()) {
      Alert.alert('What will you trade?', 'Tell the grower what you’re offering.');
      return;
    }
    if (type === 'sale' && available != null && quantity > available) {
      Alert.alert('Check the quantity', `Only ${available} available.`);
      return;
    }
    if (type === 'sale' && firstSlots.length > 0 && !pickupSlot) {
      Alert.alert('Pick a pickup time', 'Choose one of the seller’s available pickup windows.');
      return;
    }
    // Structured selection rules.
    if (hasOptions && !picked && !pickedCustom) {
      Alert.alert(
        type === 'plot' ? 'What would you like grown?' : 'What can you offer?',
        'Pick one of the options first.',
      );
      return;
    }
    if (pickedCustom && !allowCustom) {
      Alert.alert('Please choose an option', 'This grower only accepts the listed choices.');
      return;
    }
    if (pickedCustom && !note.trim()) {
      Alert.alert('Add a detail', 'Tell them what you have in mind.');
      return;
    }
    // Plot with no structured options still requires a free-text request.
    if (type === 'plot' && !hasOptions && !note.trim()) {
      Alert.alert('What should they grow?', 'Tell the grower what you’d like grown in your plot.');
      return;
    }
    claim.mutate(
      {
        listingId: listing.id,
        title: listing.title,
        claimType: c.claimType,
        tradeOfferText: type === 'trade' ? tradeOffer.trim() : null,
        // Plot reservations require a non-empty note (DB constraint): fall back
        // to the chosen crop label when the free-text detail is blank.
        buyerNote:
          type === 'sale'
            ? [
                `Payment preference: ${METHOD_LABEL[chosenPayment]}`,
                note.trim() ? `Note: ${note.trim()}` : null,
              ].filter(Boolean).join('\n')
            : note.trim() || (type === 'plot' ? picked?.label ?? null : null),
        selectedOptionLabel: picked?.label ?? null,
        selectedTaxonomyNodeId: picked?.node_id ?? null,
        isCustomOption: pickedCustom,
        agreedPriceCents:
          type === 'sale' ? estimatedTotal
          : type === 'plot' ? listing.price_cents ?? 0
          : null,
        quantityRequested: type === 'sale' ? quantity : null,
        paymentMethod: type === 'sale' ? chosenPayment : null,
        pickupStart: type === 'sale' ? pickupSlot?.slot_start ?? null : null,
        pickupEnd: type === 'sale' ? pickupSlot?.slot_end ?? null : null,
        paymentStatus: type === 'sale' || type === 'plot' ? 'external' : 'none',
      },
      {
        onSuccess: () => {
          Alert.alert('Request sent!', 'The grower will review it. You can chat once it’s approved.', [
            { text: 'OK', onPress: () => router.replace('/activity') },
          ]);
        },
        onError: (e: any) => {
          const raw = e?.message ?? '';
          // The Wanted gate's stable codes come first: they carry their own seller-facing copy and
          // the limit case deserves an upgrade path, not a dead end. parseServerError strips the
          // code prefix so a raw token never reaches the screen.
          const parsed = parseServerError(raw);
          if (parsed?.code === 'WANTED_INTRO_LIMIT_REACHED') {
            Alert.alert(parsed.title, parsed.message, [
              { text: 'Not now', style: 'cancel' },
              { text: 'See plans', onPress: () => router.push('/upgrade') },
            ]);
            return;
          }
          if (parsed?.code === 'ACCOUNT_NOT_READY') {
            Alert.alert(parsed.title, parsed.message, [
              { text: 'Not now', style: 'cancel' },
              { text: 'Finish setup', onPress: () => router.push('/account-ready' as never) },
            ]);
            return;
          }
          if (parsed?.code === 'WANTED_ALREADY_CONTACTED' || parsed?.code === 'WANTED_NOT_AVAILABLE') {
            Alert.alert(parsed.title, parsed.message);
            return;
          }
          const msg = /duplicate|unique/i.test(raw)
            ? 'You’ve already sent a request for this listing.'
            : /BLOCKED_USER/i.test(raw)
              ? 'You can’t send requests to this neighbor.'
              : raw || 'Please try again.';
          Alert.alert('Could not send', msg);
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>{c.heading}</Text>
        <Text style={styles.sub}>
          {cat.emoji} {cat.label}
          {listing.market?.name ? ` · 🏡 ${listing.market.name}` : ''}
        </Text>

        {type === 'sale' && (
          <View style={styles.reserveCard}>
            <Text style={styles.reserveTitle}>{listing.price_cents != null ? formatPrice(listing.price_cents, listing.unit) : 'Price set by seller'}</Text>
            <Text style={styles.reserveSub}>
              {available != null ? `${available} available` : 'Availability confirmed by seller'}
              {listing.market?.name ? ` · ${listing.market.name}` : ''}
            </Text>
            {marketArea ? <Text style={styles.reserveArea}>{marketArea}</Text> : null}
            {pickedLabel ? <Text style={styles.reserveArea}>🧺 {pickedLabel}</Text> : null}

            <Text style={styles.fieldLabel}>Quantity</Text>
            <View style={styles.quantityRow}>
              <Pressable
                onPress={() => stepQuantity(-1)}
                disabled={quantity <= 1}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                style={[styles.qtyBtn, quantity <= 1 && styles.qtyBtnDisabled]}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </Pressable>
              <TextInput
                style={styles.qtyInput}
                value={String(quantity)}
                onChangeText={(t) => {
                  const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                  const cap = available ?? 99;
                  setQuantity(Number.isFinite(n) ? Math.max(1, Math.min(cap, n)) : 1);
                }}
                keyboardType="number-pad"
                accessibilityLabel="Quantity"
              />
              <Pressable
                onPress={() => stepQuantity(1)}
                disabled={available != null && quantity >= available}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                style={[styles.qtyBtn, available != null && quantity >= available && styles.qtyBtnDisabled]}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </Pressable>
            </View>
            {quantityEstimate ? <Text style={styles.quantityEstimate}>{quantityEstimate}</Text> : null}

            {unitPrice != null ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{quantity} × {money(unitPrice)}</Text>
                <Text style={styles.totalValue}>Estimated total: {money(estimatedTotal ?? 0)}</Text>
              </View>
            ) : null}
          </View>
        )}

        {type === 'sale' && (
          <View style={styles.pickupBox}>
            <Text style={styles.fieldLabel}>Pickup</Text>
            <Text style={styles.pickupTitle}>{listing.market?.name ?? 'Seller Market'}</Text>
            {pickupSlots.isLoading ? (
              <Text style={styles.pickupHint}>Checking pickup windows…</Text>
            ) : firstSlots.length > 0 ? (
              <View style={styles.slotWrap}>
                {firstSlots.map((slot) => {
                  const active = pickupSlot?.slot_start === slot.slot_start;
                  return (
                    <Pressable
                      key={slot.slot_start}
                      onPress={() => setPickupSlot(slot)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.slotChip, active && styles.slotChipOn]}
                    >
                      <Text style={[styles.slotText, active && styles.slotTextOn]}>
                        {fmtShortWindow(slot.slot_start, slot.slot_end)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.pickupHint}>Pickup by appointment. The seller will confirm or suggest a time after approval.</Text>
            )}
          </View>
        )}

        {(type === 'plot') && (
          <View style={styles.priceBox}>
            <Text style={styles.priceLabel}>{type === 'plot' ? 'Reservation price' : 'Price'}</Text>
            <Text style={styles.price}>
              {listing.price_cents != null ? formatPrice(listing.price_cents, listing.unit) : '—'}
            </Text>
            <Text style={styles.priceNote}>
              {type === 'plot'
                ? 'The grower approves your request first. Payment and pickup are arranged together — Gnome never handles money.'
                : 'Payment is arranged in person — Gnome never handles money.'}
            </Text>
          </View>
        )}

        {type === 'sale' && (
          <View style={styles.paymentBox}>
            <Text style={styles.fieldLabel}>How do you plan to pay?</Text>
            <View style={styles.chips}>
              {paymentChoices.map((method) => {
                const active = chosenPayment === method;
                return (
                  <Pressable
                    key={method}
                    onPress={() => setPaymentMethod(method)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.chip, active && styles.paymentChipOn]}
                  >
                    <Text style={[styles.chipText, active && styles.paymentChipTextOn]}>{METHOD_LABEL[method]}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.paymentNote}>
              Payment is handled directly between you and the seller. Gnome does not process or hold your money.
            </Text>
          </View>
        )}

        {type === 'trade' && (
          <Field
            label="What will you trade?"
            value={tradeOffer}
            onChangeText={setTradeOffer}
            placeholder={listing.trade_for ? `They want: ${listing.trade_for}` : 'Eggs, herbs, anything from your garden'}
            multiline
            numberOfLines={3}
            style={styles.multiline}
          />
        )}

        {hasOptions && (
          <View style={styles.optionsBlock}>
            <Text style={styles.fieldLabel}>
              {type === 'plot' ? 'What would you like grown?' : 'What can you offer?'}
            </Text>
            <View style={styles.chips}>
              {options.map((o) => {
                const on = !pickedCustom && picked?.label === o.label;
                return (
                  <Pressable
                    key={o.label}
                    onPress={() => { setPicked(o); setPickedCustom(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
              {allowCustom && (
                <Pressable
                  onPress={() => { setPickedCustom(true); setPicked(null); }}
                  accessibilityRole="button"
                  accessibilityLabel="Something else"
                  accessibilityState={{ selected: pickedCustom }}
                  style={[styles.chip, pickedCustom && styles.chipOn]}
                >
                  <Text style={[styles.chipText, pickedCustom && styles.chipTextOn]}>Something else</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        <Field
          label={
            type === 'wanted'
              ? hasOptions ? 'Additional details (optional)' : 'What do you have? (optional)'
              : type === 'plot'
                ? hasOptions ? 'Additional details (optional)' : 'What should they grow?'
                : 'Anything the seller should know?'
          }
          value={note}
          onChangeText={setNote}
          placeholder={
            type === 'wanted'
              ? 'Describe what you have…'
              : type === 'plot'
                ? 'Type what you’d like them to grow…'
                : 'Could I pick up after 6? Can you leave these on the porch?'
          }
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <Button label={c.cta} onPress={submit} loading={claim.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 16 },
  heading: { fontSize: 23, fontFamily: 'Fraunces_700Bold', color: Colors.text },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 4, marginBottom: 18, fontFamily: fonts.regular },
  priceBox: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  priceLabel: { fontSize: 12, color: Colors.textSecondary, textTransform: 'uppercase', fontFamily: fonts.bold },
  price: { fontSize: 26, color: Colors.sell, marginTop: 2, fontFamily: fonts.bold },
  priceNote: { fontSize: 12, color: Colors.textTertiary, marginTop: 6, lineHeight: 17, fontFamily: fonts.regular },
  reserveCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 8,
  },
  reserveTitle: { fontSize: 21, color: Colors.gardenGreenInteractive, fontFamily: fonts.bold },
  reserveSub: { fontSize: 13, color: Colors.textSecondary, fontFamily: fonts.semibold },
  reserveArea: { fontSize: 12.5, color: Colors.textTertiary, fontFamily: fonts.regular },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quantityEstimate: { fontSize: 12.5, color: Colors.textSecondary, fontFamily: fonts.regular, lineHeight: 18 },
  qtyBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.gardenGreenInteractive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyBtnText: { color: Colors.textInverse, fontSize: 22, lineHeight: 24, fontFamily: fonts.bold },
  qtyInput: {
    width: 72,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surfaceElevated,
    textAlign: 'center',
    fontSize: 18,
    color: Colors.text,
    fontFamily: fonts.bold,
  },
  totalRow: { marginTop: 4, gap: 2 },
  totalLabel: { fontSize: 13, color: Colors.textSecondary, fontFamily: fonts.regular },
  totalValue: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold },
  pickupBox: {
    backgroundColor: Colors.marketOrangeInteractive + '10',
    borderWidth: 1,
    borderColor: Colors.marketOrangeInteractive + '35',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  pickupTitle: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold, marginBottom: 4 },
  pickupHint: { fontSize: 12.5, color: Colors.textSecondary, fontFamily: fonts.regular, lineHeight: 18 },
  slotWrap: { gap: 8, marginTop: 4 },
  slotChip: {
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.marketOrangeInteractive + '35',
  },
  slotChipOn: { backgroundColor: Colors.marketOrangeInteractive, borderColor: Colors.marketOrangeInteractive },
  slotText: { fontSize: 12.5, color: Colors.text, fontFamily: fonts.semibold },
  slotTextOn: { color: Colors.textInverse },
  paymentBox: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  paymentChipOn: { backgroundColor: Colors.gardenGreenInteractive, borderColor: Colors.gardenGreenInteractive },
  paymentChipTextOn: { color: Colors.textInverse },
  paymentNote: { marginTop: 10, fontSize: 11.5, color: Colors.textTertiary, fontFamily: fonts.regular, lineHeight: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  optionsBlock: { marginBottom: 14 },
  fieldLabel: { fontSize: 14, color: Colors.text, fontFamily: fonts.semibold, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary + '18', borderColor: Colors.primary },
  chipText: { fontSize: 14, color: Colors.text, fontFamily: fonts.semibold },
  // On a light wash of its own hue, the interactive red lands at ~4.0-4.2:1 —
  // under AA body. Same hue, deep cut: #B71C1C measures ~6:1 on these washes.
  chipTextOn: { color: Colors.primaryDark },
});

function fmtShortWindow(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const day = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time(s)}–${time(e)}`;
}
