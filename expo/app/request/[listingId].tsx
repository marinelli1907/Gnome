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
import type { ClaimType, ListingType } from '@/types';

export default function RequestScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading, error } = useListing(listingId);
  const claim = useClaimListing(userId ?? undefined);

  const [tradeOffer, setTradeOffer] = useState('');
  const [note, setNote] = useState('');
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

  const config: Record<ListingType, { heading: string; cta: string; claimType: ClaimType }> = {
    free: { heading: `Claim "${listing.title}"`, cta: 'Send claim', claimType: 'claim' },
    trade: { heading: `Offer a trade for "${listing.title}"`, cta: 'Send trade offer', claimType: 'trade_offer' },
    sale: { heading: `Request to buy "${listing.title}"`, cta: 'Send buy request', claimType: 'purchase_request' },
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
        buyerNote: note.trim() || (type === 'plot' ? picked?.label ?? null : null),
        selectedOptionLabel: picked?.label ?? null,
        selectedTaxonomyNodeId: picked?.node_id ?? null,
        isCustomOption: pickedCustom,
        agreedPriceCents:
          type === 'sale' ? listing.price_cents ?? null
          : type === 'plot' ? listing.price_cents ?? 0
          : null,
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

        {(type === 'sale' || type === 'plot') && (
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
                : 'Add a note for the grower (optional)'
          }
          value={note}
          onChangeText={setNote}
          placeholder={
            type === 'wanted'
              ? 'Describe what you have…'
              : type === 'plot'
                ? 'Type what you’d like them to grow…'
                : 'When could I pick up? Anything else to know?'
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
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  optionsBlock: { marginBottom: 14 },
  fieldLabel: { fontSize: 14, color: Colors.text, fontFamily: fonts.semibold, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary + '18', borderColor: Colors.primary },
  chipText: { fontSize: 14, color: Colors.text, fontFamily: fonts.semibold },
  chipTextOn: { color: Colors.primary },
});
