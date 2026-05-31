import React, { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, X } from 'lucide-react-native';
import { Button, Field, EmptyState } from '@/components/ui';
import { CATEGORIES } from '@/constants/categories';
import Colors from '@/constants/colors';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateListing } from '@/lib/db';
import { uploadListingImages } from '@/lib/images';
import { getCurrentCoords } from '@/lib/location';

const MAX_PHOTOS = 5;

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const createListing = useCreateListing(userId ?? undefined);

  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('vegetables');
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);

  if (!userId) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <EmptyState
          emoji="🔑"
          title="Sign in to post"
          subtitle="You need an account to share your surplus. Browsing stays free."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

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

  const submit = async () => {
    if (!title.trim()) {
      Alert.alert('Add a title', 'What are you sharing? e.g. "Cherry tomatoes"');
      return;
    }
    setBusy(true);
    try {
      const photos = assets.length ? await uploadListingImages(userId, assets) : [];
      const coords = await getCurrentCoords();
      const listing = await createListing.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        category,
        quantity: quantity.trim(),
        photos,
        coords,
      });
      setTitle('');
      setQuantity('');
      setDescription('');
      setAssets([]);
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
        <Text style={styles.heading}>Share your surplus</Text>

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
              <Text style={styles.addPhotoText}>Add photo</Text>
            </Pressable>
          )}
        </View>

        <Field label="What are you sharing?" value={title} onChangeText={setTitle} placeholder="Cherry tomatoes" />
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="About 2 lbs / a full basket" />

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
          placeholder="Picked this morning, porch pickup, come grab them!"
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <Text style={styles.note}>Listings expire after 7 days. Free to share — no payments.</Text>
        <Button label="Post listing" onPress={submit} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center' },
  container: { padding: 20, paddingBottom: 40 },
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
  },
  addPhotoText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
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
