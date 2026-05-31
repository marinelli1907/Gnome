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
import { Camera, X } from 'lucide-react-native';
import { Button, Field, EmptyState } from '@/components/ui';
import { CATEGORIES } from '@/constants/categories';
import Colors from '@/constants/colors';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateListing } from '@/lib/db';
import { uploadListingImages } from '@/lib/images';
import { getCurrentCoords } from '@/lib/location';
import type { ListingKind } from '@/types';

const MAX_PHOTOS = 5;

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const createListing = useCreateListing(userId ?? undefined);

  // Params arrive from the "I Have This" flow on a Wanted post.
  const params = useLocalSearchParams<{
    kind?: string;
    category?: string;
    title?: string;
    fulfilledBy?: string;
  }>();

  const [kind, setKind] = useState<ListingKind>(params.kind === 'wanted' ? 'wanted' : 'offer');
  const [title, setTitle] = useState(params.title ?? '');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>(params.category ?? 'vegetables');
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [fulfilledBy, setFulfilledBy] = useState<string | null>(params.fulfilledBy ?? null);
  const [busy, setBusy] = useState(false);

  // Re-apply prefill when the user re-enters via "I Have This" with new params.
  const seed = params.fulfilledBy ?? '';
  useEffect(() => {
    if (params.fulfilledBy) {
      setKind('offer');
      setFulfilledBy(params.fulfilledBy);
      if (params.title) setTitle(params.title);
      if (params.category) setCategory(params.category);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🔑"
          title="Sign in to post"
          subtitle="You need an account to share surplus or post a want. Browsing stays free."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const isWanted = kind === 'wanted';

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - assets.length,
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled) {
      setAssets((prev) => [...prev, ...result.assets].slice(0, MAX_PHOTOS));
    }
  };

  const removeAsset = (uri: string) =>
    setAssets((prev) => prev.filter((a) => a.uri !== uri));

  const reset = () => {
    setTitle('');
    setQuantity('');
    setDescription('');
    setAssets([]);
    setFulfilledBy(null);
  };

  const submit = async () => {
    if (!title.trim()) {
      Alert.alert(
        isWanted ? 'What are you looking for?' : 'Add a title',
        isWanted ? 'e.g. "Fresh basil"' : 'What are you sharing? e.g. "Cherry tomatoes"',
      );
      return;
    }
    setBusy(true);
    try {
      const photos = assets.length ? await uploadListingImages(userId, assets) : [];
      const coords = await getCurrentCoords();
      const listing = await createListing.mutateAsync({
        kind,
        title: title.trim(),
        description: description.trim(),
        category,
        quantity: quantity.trim(),
        photos,
        coords,
        fulfilledByListingId: fulfilledBy,
      });
      reset();
      router.push(`/listing/${listing.id}`);
    } catch (e: any) {
      Alert.alert('Could not post', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Kind choice — no role screen, just what you're doing right now. */}
        <View style={styles.kindRow}>
          <Pressable
            onPress={() => setKind('offer')}
            disabled={!!fulfilledBy}
            style={[styles.kindBtn, !isWanted && styles.kindBtnActive, !!fulfilledBy && isWanted && styles.kindBtnDisabled]}
          >
            <Text style={styles.kindEmoji}>🧺</Text>
            <Text style={[styles.kindText, !isWanted && styles.kindTextActive]}>I have extra</Text>
          </Pressable>
          <Pressable
            onPress={() => setKind('wanted')}
            disabled={!!fulfilledBy}
            style={[styles.kindBtn, isWanted && styles.kindBtnActive, !!fulfilledBy && styles.kindBtnDisabled]}
          >
            <Text style={styles.kindEmoji}>🔎</Text>
            <Text style={[styles.kindText, isWanted && styles.kindTextActive]}>I&apos;m looking for</Text>
          </Pressable>
        </View>

        {fulfilledBy ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              You&apos;re creating an offer in response to a Wanted post. Once posted,
              the neighbor who wanted it can claim your offer.
            </Text>
          </View>
        ) : null}

        <Text style={styles.heading}>{isWanted ? 'Post what you need' : 'Share your surplus'}</Text>

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
            <Pressable style={styles.addPhoto} onPress={pickImages}>
              <Camera size={24} color={Colors.primary} />
              <Text style={styles.addPhotoText}>
                {isWanted ? 'Add photo (optional)' : 'Add photo'}
              </Text>
            </Pressable>
          )}
        </View>

        <Field
          label={isWanted ? 'What are you looking for?' : 'What are you sharing?'}
          value={title}
          onChangeText={setTitle}
          placeholder={isWanted ? 'Fresh basil' : 'Cherry tomatoes'}
        />
        <Field
          label={isWanted ? 'How much do you need? (optional)' : 'Quantity'}
          value={quantity}
          onChangeText={setQuantity}
          placeholder={isWanted ? 'A handful for pesto' : 'About 2 lbs / a full basket'}
        />

        <Text style={styles.fieldLabel}>Category</Text>
        <View style={styles.catWrap}>
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.catChip, active && styles.catChipActive]}
              >
                <Text style={[styles.catText, active && styles.catTextActive]}>
                  {c.emoji} {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          label="Details (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder={
            isWanted
              ? 'Making sauce this weekend — happy to swap or just grateful!'
              : 'Picked this morning, porch pickup, come grab them!'
          }
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <Text style={styles.note}>
          {isWanted
            ? 'Wanted posts expire after 30 days. Neighbors with a match can offer it to you.'
            : 'Listings expire after 7 days. Free to share — no payments.'}
        </Text>
        <Button
          label={isWanted ? 'Post want' : fulfilledBy ? 'Create offer' : 'Post listing'}
          onPress={submit}
          loading={busy}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  container: { padding: 20, paddingBottom: 40 },
  kindRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  kindBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  kindBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  kindBtnDisabled: { opacity: 0.5 },
  kindEmoji: { fontSize: 22 },
  kindText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  kindTextActive: { color: Colors.primary },
  banner: {
    backgroundColor: Colors.secondary + '22',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  heading: { fontSize: 24, fontWeight: '800', color: Colors.text, marginBottom: 16 },
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
  addPhotoText: { fontSize: 10, color: Colors.primary, fontWeight: '600', textAlign: 'center' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  catTextActive: { color: Colors.textInverse },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  note: { fontSize: 13, color: Colors.textTertiary, marginBottom: 16, lineHeight: 18 },
});
