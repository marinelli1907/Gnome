import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, ChevronRight, Sparkles, X } from 'lucide-react-native';
import { Button, Field, EmptyState } from '@/components/ui';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import ComplianceGate from '@/components/ComplianceGate';
import {
  useTaxonomy,
  usePublishEligibility,
  breadcrumb,
  legacyCategoryFor,
  rootForLegacy,
  parseServerError,
} from '@/lib/taxonomy';
import { alertListingWriteError, alertUnderReview, isUnderReview, safeErrorText } from '@/lib/screening';
import { DEFAULT_LISTING_TYPE, TYPE_CHOICES, listingTypeFromParam } from '@/lib/listingType';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateListing, useMyCredentials, useMyMarket, logEvent } from '@/lib/db';
import { draftListingFromPhoto } from '@/lib/ai';
import { pickImages, uploadListingImages } from '@/lib/images';
import { purchaseOverage } from '@/lib/billing';
import { getCurrentCoords } from '@/lib/location';
import type { ListingType } from '@/types';

const MAX_PHOTOS = 5;

// Copy is per type and stays per type: Sell wording shows while Sell is
// selected, and the Share Free wording below is still exactly what Share Free
// says — it just isn't what the screen opens on any more.
const HEADING: Record<ListingType, string> = {
  sale: 'List something for sale',
  free: 'Share your surplus',
  trade: 'Offer a trade',
  wanted: 'Post what you need',
  plot: 'Offer a garden plot',
};

const NOTE: Record<ListingType, string> = {
  sale: 'Expires after 7 days. Payments happen offline, in person — Gnome never handles money.',
  free: 'Listings expire after 7 days. Free to share — no payments.',
  trade: 'Listings expire after 7 days. Arrange the swap in person.',
  wanted: 'Wanted posts expire after 30 days. Neighbors with a match can offer it to you.',
  plot: 'Neighbors request your plot and tell you what to grow. You approve, then arrange payment together — Gnome never handles money.',
};

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const createListing = useCreateListing(userId ?? undefined);
  const myMarket = useMyMarket(userId ?? undefined);

  const params = useLocalSearchParams<{
    type?: string;
    category?: string;
    taxNode?: string;
    title?: string;
    quantity?: string;
    description?: string;
    fulfilledBy?: string;
    n?: string;
  }>();

  // Resolved before the first render, so the first paint is already the right
  // type — never Share Free flashing into Sell. An explicit `?type=` (deep link,
  // repost, Grow Log harvest) wins; a Wanted response is locked to Share Free
  // because that is the only thing it can be; everything else opens on Sell.
  const initialType: ListingType = params.fulfilledBy
    ? 'free'
    : listingTypeFromParam(params.type) ?? DEFAULT_LISTING_TYPE;

  const [type, setType] = useState<ListingType>(initialType);
  const [title, setTitle] = useState(params.title ?? '');
  const [quantity, setQuantity] = useState(params.quantity ?? '');
  // AI Listing Assistant prefill (params come from the AI sheet on Sell)
  const aiPrefill = params as unknown as {
    aiTitle?: string; aiDescription?: string; aiPrice?: string; aiUnit?: string; aiNode?: string;
  };
  const [description, setDescription] = useState(params.description ?? '');
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [inventory, setInventory] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [fulfilledBy, setFulfilledBy] = useState<string | null>(params.fulfilledBy ?? null);
  // Optional structured options: Wanted acceptable variants / Plot supported crops.
  const [reqOptions, setReqOptions] = useState<{ label: string; node_id?: string | null }[]>([]);
  const [optionDraft, setOptionDraft] = useState('');
  const [allowCustomRequest, setAllowCustomRequest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const taxonomy = useTaxonomy();
  const index = taxonomy.data;
  const selectedNode = index && taxNodeId ? index.byId.get(taxNodeId) ?? null : null;
  const isPlot = type === 'plot';

  // Server-side verdict for the chosen node (drafts/plots skip the check).
  const eligibility = usePublishEligibility(isPlot ? null : taxNodeId, userId ?? undefined);
  const myCredentials = useMyCredentials(userId ?? undefined);
  const latestDenial = myCredentials.data?.find(
    (c) => (c.status === 'DENIED' || c.status === 'REVOKED') && c.denial_reason,
  )?.denial_reason;

  const seed = `${params.fulfilledBy ?? ''}|${params.title ?? ''}|${params.type ?? ''}|${params.n ?? ''}`;
  useEffect(() => {
    if (params.fulfilledBy || params.title || params.category || params.taxNode || params.type) {
      // Re-seeding on a later param change (repost, another Grow Log harvest):
      // an explicit type still wins, and an unreadable one leaves the user's
      // current choice alone rather than yanking it back to the default.
      const seeded = listingTypeFromParam(params.type);
      if (seeded) setType(seeded);
      if (params.fulfilledBy) setType('free');
      if (params.title) setTitle(params.title);
      if (params.category && index) {
        const root = rootForLegacy(index, params.category);
        if (root) setTaxNodeId(root.id);
      }
      // Direct taxonomy prefill (e.g. Grow Log "List harvest") — an exact node
      // id, so it doesn't need the legacy-category mapping and wins over it.
      if (typeof params.taxNode === 'string' && params.taxNode) setTaxNodeId(params.taxNode);
      if (params.quantity) setQuantity(params.quantity);
      if (aiPrefill.aiTitle) setTitle(aiPrefill.aiTitle);
      if (aiPrefill.aiDescription) setDescription(aiPrefill.aiDescription);
      if (aiPrefill.aiPrice) setPrice(aiPrefill.aiPrice);
      if (aiPrefill.aiUnit) setUnit(aiPrefill.aiUnit);
      if (aiPrefill.aiNode) setTaxNodeId(aiPrefill.aiNode);
      if (params.description) setDescription(params.description);
      setFulfilledBy(params.fulfilledBy ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, !!index]);

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🔑"
          title="Sign in to post"
          subtitle="You need an account to share, trade, sell, or request. Browsing stays free."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const isWanted = type === 'wanted';

  const onAddPhotos = async () => {
    // pickImages re-encodes to JPEG, which strips the original camera metadata
    // (an iPhone library photo still carries its GPS EXIF) before it can be
    // uploaded to the public bucket or sent to the AI drafter.
    const picked = await pickImages({ selectionLimit: MAX_PHOTOS - assets.length });
    if (picked.length) setAssets((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  };

  const removeAsset = (uri: string) => setAssets((prev) => prev.filter((a) => a.uri !== uri));

  // ✨ Snap a photo → Claude drafts the listing. Fills only fields the user
  // hasn't typed in yet — never clobbers their words. Best-effort: on any
  // failure they just keep filling the form by hand.
  const draftWithAi = async () => {
    const photo = assets.find((a) => a.base64);
    if (!photo?.base64) {
      Alert.alert('Add a photo first', 'Pick a photo and I’ll draft the listing from it.');
      return;
    }
    setAiBusy(true);
    try {
      const draft = await draftListingFromPhoto({
        base64: photo.base64,
        mimeType: photo.mimeType,
        listingType: type,
      });
      if (!title.trim() && draft.title) setTitle(draft.title);
      if (!description.trim() && draft.description) setDescription(draft.description);
      if (draft.category && !taxNodeId && index) {
        const root = rootForLegacy(index, draft.category);
        if (root) setTaxNodeId(root.id);
      }
      if (type === 'sale') {
        if (!price.trim() && draft.suggested_price_cents != null) {
          setPrice((draft.suggested_price_cents / 100).toFixed(2).replace(/\.00$/, ''));
        }
        if (!unit.trim() && draft.suggested_unit) setUnit(draft.suggested_unit);
      }
      void logEvent('ai_draft_used', { userId, metadata: { listing_type: type } });
    } catch (e: any) {
      Alert.alert('Couldn’t draft it', e?.message ?? 'Try again, or just fill it in yourself.');
    } finally {
      setAiBusy(false);
    }
  };

  const reset = () => {
    // Deliberately NOT reset to the canonical default. Sell is the default when the user arrives
    // with no stated intent; someone who just posted a Share Free item and tapped "Post another"
    // has stated one, and a seller listing five things in a row should not re-pick the type each
    // time. Web behaves the same way (SellClient reset() leaves listingType alone) — the two were
    // briefly divergent and this is the agreed reading.
    setTitle('');
    setQuantity('');
    setDescription('');
    setTaxNodeId(null);
    setAssets([]);
    setPrice('');
    setUnit('');
    setInventory('');
    setTradeFor('');
    setFulfilledBy(null);
    setReqOptions([]);
    setOptionDraft('');
    setAllowCustomRequest(true);
  };

  const addOption = () => {
    const label = optionDraft.trim();
    if (!label) return;
    if (reqOptions.length >= 20) return;
    if (reqOptions.some((o) => o.label.toLowerCase() === label.toLowerCase())) { setOptionDraft(''); return; }
    setReqOptions((prev) => [...prev, { label }]);
    setOptionDraft('');
  };

  const blocked = !isPlot && !!selectedNode && eligibility.data ? !eligibility.data.allowed : false;
  const prohibited = blocked && eligibility.data?.reason === 'PROHIBITED';

  // $0.99 overage: server-priced, server-authorized. On 'paid' the SAME submit runs again with
  // the form state untouched — that is the draft-preservation guarantee. 'pending' means the
  // webhook is still landing; the seller retries publish, never payment.
  const payAndRetryPublish = async () => {
    const outcome = await purchaseOverage(null);
    if (outcome === 'paid' || outcome === 'not_needed') {
      await submit();
    } else if (outcome === 'pending') {
      Alert.alert('Payment received', 'Stripe is confirming your payment. Tap Publish again in a few seconds — you will not be charged twice.');
    } else if (outcome === 'error') {
      Alert.alert('Something went wrong', 'The checkout could not start. Nothing was charged — your draft is safe. Please try again.');
    }
    // 'cancelled': silent — the seller backed out on purpose, the draft is untouched.
  };

  const submit = async () => {
    if (!title.trim()) {
      Alert.alert(isWanted ? 'What are you looking for?' : 'Add a title', 'Give your listing a short title.');
      return;
    }
    if (!isPlot && !selectedNode) {
      Alert.alert(
        isWanted ? 'What kind of item?' : 'What are you selling?',
        'Pick a category so neighbors can find it.',
      );
      setPickerOpen(true);
      return;
    }
    if (prohibited) {
      Alert.alert('Not allowed on Gnome', eligibility.data?.message ?? 'This product cannot be listed.');
      return;
    }
    let priceCents: number | null = null;
    if (type === 'sale' || type === 'plot') {
      const dollars = parseFloat(price);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        Alert.alert(
          'Add a price',
          type === 'plot'
            ? 'Set what it costs to reserve this plot for the season.'
            : 'Sale listings need a price greater than $0.',
        );
        return;
      }
      priceCents = Math.round(dollars * 100);
    }
    let inventoryCount: number | null = null;
    if (inventory.trim()) {
      const n = parseInt(inventory, 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Check the amount', 'Quantity available must be a whole number above 0.');
        return;
      }
      inventoryCount = n;
    }
    if (type === 'trade' && !tradeFor.trim()) {
      Alert.alert('What would you like?', 'Tell neighbors what you’d trade for.');
      return;
    }

    // Blocked by compliance → the primary action becomes "Save draft": the
    // listing is stored as `paused`, invisible to buyers, and auto-publishes
    // when approval/renewal makes the seller eligible again.
    const asDraft = blocked;

    setBusy(true);
    try {
      const photos = assets.length ? await uploadListingImages(userId, assets) : [];
      const coords = await getCurrentCoords();
      const listing = await createListing.mutateAsync({
        listingType: type,
        title: title.trim(),
        description: description.trim(),
        category: !isPlot && selectedNode && index ? legacyCategoryFor(index, selectedNode) : 'other',
        taxonomyNodeId: isPlot ? null : selectedNode?.id ?? null,
        status: asDraft ? 'paused' : 'active',
        quantity: quantity.trim(),
        photos,
        coords,
        priceCents,
        unit: unit.trim() || null,
        inventoryCount,
        tradeFor: tradeFor.trim() || null,
        fulfilledByListingId: fulfilledBy,
        requestOptions: (isWanted || isPlot) && reqOptions.length ? reqOptions : null,
        allowCustomRequest: (isWanted || isPlot) ? allowCustomRequest : undefined,
      });
      reset();
      // The insert SUCCEEDED and the row is saved — but the screening trigger
      // can have parked it as `paused` on the way in, so anything that reads
      // like "you're live" here would be a lie. This wins over the draft notice
      // below when both apply: both mean "not public", and the server's reason
      // is the more specific truth (the compliance gate already explained the
      // draft path inline, before they tapped Save).
      if (isUnderReview(listing)) {
        alertUnderReview(listing, { onClose: () => router.push(`/listing/${listing.id}`) });
        return;
      }
      if (asDraft) {
        Alert.alert(
          'Saved as draft',
          'Your listing is saved and not visible to buyers. Once your plan/verification is in order it can go live from My Gnome.',
        );
      }
      router.push(`/listing/${listing.id}`);
    } catch (e: any) {
      const msg = e?.message ?? '';
      // A prohibited item and a rate limit read the same on every screen, so
      // the shared handler owns them — a raw prefix can never reach a seller.
      if (alertListingWriteError(msg)) return;
      const err = parseServerError(msg);
      if (err?.code === 'COMPLIANCE_BLOCKED') {
        // The server gate is the authority — render its verdict even if the
        // client somehow thought this was publishable.
        Alert.alert(err.title, err.message);
      } else if (err?.code === 'PUBLISH_ALLOWANCE_EXHAUSTED') {
        // 0104 model: a monthly publish allowance that expiry does not refund. The draft is
        // preserved by construction — the insert was refused, and the form state is untouched,
        // so a successful $0.99 purchase can simply run the same submit again.
        void logEvent('plan_limit_hit', { userId, metadata: { listing_type: type, model: 'allowance' } });
        Alert.alert(
          'Included listings used up',
          'You’ve used your included Sell listings for this period. Your draft is saved right here either way.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See plans', onPress: () => router.push('/upgrade') },
            { text: 'Publish for $0.99', onPress: () => void payAndRetryPublish() },
          ],
        );
      } else if (err?.code === 'PLAN_LIMIT_REACHED') {
        // Transitional: production still runs the pre-0104 active-listing gate until the
        // allowance migrations apply. The old copy here claimed "10 active listings", which was
        // never true on any plan — the Free cap is 5 today.
        void logEvent('plan_limit_hit', { userId, metadata: { listing_type: type, model: 'active_cap' } });
        Alert.alert(
          'Listing limit reached',
          'You’re at your plan’s listing limit right now. Upgrade for more room, or try again after a listing wraps up.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See plans', onPress: () => router.push('/upgrade') },
          ],
        );
      } else {
        Alert.alert('Could not post', safeErrorText(msg, 'Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]} keyboardShouldPersistTaps="handled">
        {/* Step 1: what kind of listing? */}
        <View style={styles.typeGrid}>
          {TYPE_CHOICES.map((c) => {
            const active = type === c.value;
            const locked = !!fulfilledBy && c.value !== 'free';
            return (
              <Pressable
                key={c.value}
                disabled={locked}
                onPress={() => setType(c.value)}
                style={[styles.typeBtn, active && styles.typeBtnActive, locked && styles.typeBtnDisabled]}
              >
                <Text style={styles.typeEmoji}>{c.emoji}</Text>
                <Text style={[styles.typeText, active && styles.typeTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Step 3 surfaced early: where it posts (the user's Market). */}
        {myMarket.data ? (
          <Pressable style={styles.marketLine} onPress={() => router.push(`/market/edit/${myMarket.data!.id}`)}>
            <Text style={styles.marketText} numberOfLines={1}>Posting to 🏡 {myMarket.data.name}</Text>
            <Text style={styles.marketEdit}>Rename</Text>
          </Pressable>
        ) : null}

        {fulfilledBy ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              You&apos;re offering this in response to a Wanted post. Once posted, the
              neighbor who wanted it can claim it.
            </Text>
          </View>
        ) : null}

        <Text style={styles.heading}>{HEADING[type]}</Text>

        {/* Photos */}
        <View style={styles.photoRow}>
          {assets.map((a) => (
            <View key={a.uri} style={styles.photo}>
              <Image source={{ uri: a.uri }} style={styles.photoImg} contentFit="cover" />
              <Pressable style={styles.removeBtn} onPress={() => removeAsset(a.uri)}>
                <X size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
          {assets.length < MAX_PHOTOS && (
            <Pressable style={styles.addPhoto} onPress={onAddPhotos}>
              <Camera size={24} color={Colors.primary} />
              <Text style={styles.addPhotoText}>{isWanted ? 'Add photo (optional)' : 'Add photo'}</Text>
            </Pressable>
          )}
        </View>

        {!isWanted && assets.some((a) => a.base64) && (
          <Pressable
            style={[styles.aiBtn, aiBusy && styles.aiBtnBusy]}
            onPress={draftWithAi}
            disabled={aiBusy}
          >
            <Sparkles size={16} color={Colors.primary} />
            <Text style={styles.aiBtnText}>
              {aiBusy ? 'Looking at your photo…' : 'Draft it for me from the photo'}
            </Text>
          </Pressable>
        )}

        {/* Common */}
        {!isWanted && (
          <Pressable
            onPress={() => router.push('/ai-listing' as never)}
            accessibilityRole="button"
            style={styles.aiBanner}
          >
            <Text style={styles.aiBannerEmoji}>✨</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiBannerTitle}>Take a photo — Gnome drafts it</Text>
              <Text style={styles.aiBannerSub}>AI Listing Assistant · included with paid plans</Text>
            </View>
            <Text style={styles.aiBannerArrow}>→</Text>
          </Pressable>
        )}

        {/* Sellers with an existing inventory elsewhere: import it instead of retyping. */}
        {!isWanted && (
          <Pressable
            onPress={() => router.push('/import' as never)}
            accessibilityRole="button"
            style={styles.importHint}
          >
            <Text style={styles.importHintText}>
              Already selling on Facebook or at a farm stand?{' '}
              <Text style={styles.importHintLink}>Build My Market with Gnome →</Text>
            </Text>
          </Pressable>
        )}

        <Field
          label={isWanted ? 'What are you looking for?' : 'Title'}
          value={title}
          onChangeText={setTitle}
          placeholder={isWanted ? 'Fresh basil' : 'Cherry tomatoes'}
        />
        <Field
          label={isWanted ? 'How much do you need? (optional)' : isPlot ? 'Plot size' : 'Quantity (optional)'}
          value={quantity}
          onChangeText={setQuantity}
          placeholder={isWanted ? 'A handful for pesto' : isPlot ? '4×8 ft raised bed' : 'About 2 lbs / a full basket'}
        />

        {/* Type-specific */}
        {type === 'sale' && (
          <View style={styles.typeFields}>
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field label="Price ($)" value={price} onChangeText={setPrice} placeholder="5" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Per unit (optional)" value={unit} onChangeText={setUnit} placeholder="lb, dozen, bunch" autoCapitalize="none" />
              </View>
            </View>
            <Field label="Quantity available (optional)" value={inventory} onChangeText={setInventory} placeholder="12" keyboardType="number-pad" />
            <Text style={styles.hint}>Payment is arranged in person — Gnome never handles money.</Text>
          </View>
        )}
        {type === 'trade' && (
          <Field
            label="What would you like in return?"
            value={tradeFor}
            onChangeText={setTradeFor}
            placeholder="Eggs, herbs, or anything from your garden"
          />
        )}
        {type === 'plot' && (
          <View style={styles.typeFields}>
            <Field
              label="Reservation price ($)"
              value={price}
              onChangeText={setPrice}
              placeholder="60"
              keyboardType="decimal-pad"
            />
            <Field
              label="Plots available"
              value={inventory}
              onChangeText={setInventory}
              placeholder="1"
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>
              What a neighbor pays to reserve one plot for the season. Offering several
              identical plots? Set how many — the listing stays up until the last one
              is reserved. They tell you what to grow; you approve and settle payment directly.
            </Text>
          </View>
        )}

        {(isWanted || isPlot) && (
          <View style={styles.typeFields}>
            <Text style={styles.fieldLabel}>
              {isPlot ? 'What can be grown here? (optional)' : 'What would you accept? (optional)'}
            </Text>
            <Text style={styles.hint}>
              {isPlot
                ? 'List the crops you’re willing to grow. Buyers pick from these when they reserve.'
                : 'List the variants you’d accept (e.g. Pie pumpkins, Any variety). Responders pick from these.'}
            </Text>
            {reqOptions.length > 0 && (
              <View style={styles.chips}>
                {reqOptions.map((o, i) => (
                  <Pressable
                    key={o.label}
                    onPress={() => setReqOptions((prev) => prev.filter((_, j) => j !== i))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove option ${o.label}`}
                    style={styles.optChip}
                  >
                    <Text style={styles.optChipText}>{o.label}  ✕</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.optRow}>
              <TextInput
                style={styles.optInput}
                value={optionDraft}
                onChangeText={setOptionDraft}
                placeholder={isPlot ? 'Add a crop…' : 'Add an option…'}
                placeholderTextColor={Colors.textTertiary}
                onSubmitEditing={addOption}
                returnKeyType="done"
                accessibilityLabel="New option"
              />
              <Pressable onPress={addOption} accessibilityRole="button" accessibilityLabel="Add option" style={styles.optAdd}>
                <Text style={styles.optAddText}>+ Add</Text>
              </Pressable>
            </View>
            <View style={styles.optToggleRow}>
              <Text style={styles.optToggleLabel}>Allow “Something else” requests</Text>
              <Switch value={allowCustomRequest} onValueChange={setAllowCustomRequest} />
            </View>
          </View>
        )}

        {!isPlot && (
          <>
            <Text style={styles.fieldLabel}>{isWanted ? 'What kind of item?' : 'What are you selling?'}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selectedNode && index
                  ? `Category: ${breadcrumb(index, selectedNode)}. Tap to change.`
                  : 'Choose a category'
              }
              onPress={() => setPickerOpen(true)}
              style={[styles.catSelector, !selectedNode && styles.catSelectorEmpty]}
            >
              <Text
                style={[styles.catSelectorText, !selectedNode && styles.catSelectorPlaceholder]}
                numberOfLines={1}
              >
                {selectedNode && index ? breadcrumb(index, selectedNode) : 'Choose a category…'}
              </Text>
              <ChevronRight size={18} color={selectedNode ? Colors.primary : Colors.textTertiary} />
            </Pressable>

            {selectedNode && eligibility.data ? (
              <ComplianceGate
                eligibility={eligibility.data}
                scopeNodeId={selectedNode.id}
                denialReason={latestDenial}
              />
            ) : null}
          </>
        )}

        <Field
          label={isWanted ? 'Request details (optional)' : 'Details (optional)'}
          value={description}
          onChangeText={setDescription}
          placeholder={isWanted ? 'Making sauce this weekend — happy to swap!' : 'Picked this morning, porch pickup, come grab them!'}
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <Text style={styles.note}>{NOTE[type]}</Text>
        <Button
          label={
            prohibited
              ? 'Not available'
              : blocked
                ? 'Save draft'
                : isWanted ? 'Post want' : type === 'sale' ? 'List for sale' : type === 'trade' ? 'Post trade' : type === 'plot' ? 'Offer plot' : 'Post listing'
          }
          onPress={submit}
          loading={busy}
          disabled={prohibited}
        />
      </ScrollView>
      {index ? (
        <TaxonomyPicker
          visible={pickerOpen}
          index={index}
          selectedId={taxNodeId}
          mode="sell"
          onSelect={(node) => setTaxNodeId(node?.id ?? null)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  aiBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: 1.5, borderColor: Colors.primary + '55',
  },
  aiBannerEmoji: { fontSize: 20 },
  aiBannerTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  aiBannerSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 1 },
  aiBannerArrow: { fontSize: 16, color: Colors.primary, fontFamily: fonts.bold },
  importHint: { marginTop: -6, marginBottom: 14, paddingHorizontal: 2 },
  importHintText: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 18 },
  importHintLink: { fontFamily: fonts.semibold, color: Colors.primary },
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  container: { padding: 20, paddingBottom: 40 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  typeBtn: {
    width: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  typeBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  typeBtnDisabled: { opacity: 0.4 },
  typeEmoji: { fontSize: 22, fontFamily: fonts.regular },
  typeText: { fontSize: 14, color: Colors.textSecondary, fontFamily: fonts.semibold },
  typeTextActive: { color: Colors.primary },
  marketLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  marketText: { flex: 1, fontSize: 13, color: Colors.text, fontFamily: fonts.semibold },
  marketEdit: { fontSize: 13, color: Colors.primary, fontFamily: fonts.bold },
  banner: { backgroundColor: Colors.secondary + '22', borderRadius: 12, padding: 12, marginBottom: 16 },
  bannerText: { fontSize: 13, color: Colors.text, lineHeight: 19, fontFamily: fonts.regular },
  heading: { fontSize: 25, fontFamily: 'Fraunces_700Bold', color: Colors.text, marginBottom: 16 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  photo: { width: 84, height: 84, borderRadius: 12, overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhoto: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  addPhotoText: { fontSize: 10, color: Colors.primary, textAlign: 'center', fontFamily: fonts.semibold },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
    marginTop: -8,
    marginBottom: 20,
  },
  aiBtnBusy: { opacity: 0.6 },
  aiBtnText: { fontSize: 14, color: Colors.primary, fontFamily: fonts.bold },
  typeFields: { gap: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  optChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary },
  optChipText: { fontSize: 13.5, color: Colors.primary, fontFamily: fonts.semibold },
  optRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  optInput: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: Colors.text, fontFamily: fonts.regular },
  optAdd: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  optAddText: { color: Colors.textInverse, fontFamily: fonts.bold, fontSize: 13.5 },
  optToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  optToggleLabel: { fontSize: 14, color: Colors.text, fontFamily: fonts.regular },
  rowFields: { flexDirection: 'row', gap: 12 },
  hint: { fontSize: 12, color: Colors.textTertiary, marginTop: -6, marginBottom: 8, fontFamily: fonts.regular },
  fieldLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8, fontFamily: fonts.semibold },
  catSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
    paddingHorizontal: 14,
    marginBottom: 16,
    gap: 8,
  },
  catSelectorEmpty: { borderColor: Colors.border, backgroundColor: Colors.surface, borderStyle: 'dashed' },
  catSelectorText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  catSelectorPlaceholder: { color: Colors.textTertiary, fontFamily: fonts.regular },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  note: { fontSize: 13, color: Colors.textTertiary, marginBottom: 16, lineHeight: 18, fontFamily: fonts.regular },
});
