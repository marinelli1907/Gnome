import React, { useEffect, useState } from 'react';
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
  parseComplianceError,
} from '@/lib/taxonomy';
import { TYPE_CHOICES } from '@/lib/listingType';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateListing, useMyCredentials, useMyMarket, logEvent } from '@/lib/db';
import { draftListingFromPhoto } from '@/lib/ai';
import { pickImages, uploadListingImages } from '@/lib/images';
import { getCurrentCoords } from '@/lib/location';
import type { ListingType } from '@/types';

const MAX_PHOTOS = 5;

const HEADING: Record<ListingType, string> = {
  free: 'Share your surplus',
  trade: 'Offer a trade',
  sale: 'List something for sale',
  wanted: 'Post what you need',
  plot: 'Offer a garden plot',
};

const NOTE: Record<ListingType, string> = {
  free: 'Listings expire after 7 days. Free to share — no payments.',
  trade: 'Listings expire after 7 days. Arrange the swap in person.',
  sale: 'Expires after 7 days. Payments happen offline, in person — Gnome never handles money.',
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
    title?: string;
    quantity?: string;
    description?: string;
    fulfilledBy?: string;
    n?: string;
  }>();

  const initialType = (['free', 'trade', 'sale', 'wanted', 'plot'] as const).includes(params.type as ListingType)
    ? (params.type as ListingType)
    : 'free';

  const [type, setType] = useState<ListingType>(initialType);
  const [title, setTitle] = useState(params.title ?? '');
  const [quantity, setQuantity] = useState(params.quantity ?? '');
  const [description, setDescription] = useState(params.description ?? '');
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [inventory, setInventory] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [fulfilledBy, setFulfilledBy] = useState<string | null>(params.fulfilledBy ?? null);
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
    if (params.fulfilledBy || params.title || params.category || params.type) {
      if (params.type && (['free', 'trade', 'sale', 'wanted', 'plot'] as const).includes(params.type as ListingType)) {
        setType(params.type as ListingType);
      }
      if (params.fulfilledBy) setType('free');
      if (params.title) setTitle(params.title);
      if (params.category && index) {
        const root = rootForLegacy(index, params.category);
        if (root) setTaxNodeId(root.id);
      }
      if (params.quantity) setQuantity(params.quantity);
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
  };

  const blocked = !isPlot && !!selectedNode && eligibility.data ? !eligibility.data.allowed : false;
  const prohibited = blocked && eligibility.data?.reason === 'PROHIBITED';

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
      });
      reset();
      if (asDraft) {
        Alert.alert(
          'Saved as draft',
          'Your listing is saved and not visible to buyers. Once your plan/verification is in order it can go live from My Gnome.',
        );
      }
      router.push(`/listing/${listing.id}`);
    } catch (e: any) {
      const msg = e?.message ?? '';
      const compliance = parseComplianceError(msg);
      if (compliance) {
        // The server gate is the authority — render its verdict even if the
        // client somehow thought this was publishable.
        Alert.alert(
          compliance.reason === 'PLAN_REQUIRED' ? 'Paid plan required' : 'Verification required',
          compliance.message ||
            'This category needs verification before publishing. You can save a draft instead.',
        );
      } else if (/PLAN_LIMIT_REACHED/i.test(msg)) {
        void logEvent('plan_limit_hit', { userId, metadata: { listing_type: type } });
        Alert.alert(
          'You’ve reached your Free limit',
          'Free Markets can have up to 10 active listings. Upgrade to Grower for more.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See upgrade', onPress: () => router.push('/upgrade') },
          ],
        );
      } else {
        Alert.alert('Could not post', msg || 'Please try again.');
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
        <Field
          label={isWanted ? 'What are you looking for?' : 'Title'}
          value={title}
          onChangeText={setTitle}
          placeholder={isWanted ? 'Fresh basil' : 'Cherry tomatoes'}
        />
        <Field
          label={isWanted ? 'How much do you need? (optional)' : 'Quantity (optional)'}
          value={quantity}
          onChangeText={setQuantity}
          placeholder={isWanted ? 'A handful for pesto' : 'About 2 lbs / a full basket'}
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
            <Text style={styles.hint}>
              What a neighbor pays to reserve this plot for the season. They tell you what to grow;
              you approve and settle payment directly.
            </Text>
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
