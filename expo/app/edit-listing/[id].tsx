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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, EmptyState } from '@/components/ui';
import { CATEGORIES } from '@/constants/categories';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useListing, useUpdateListing } from '@/lib/db';

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading } = useListing(id);
  const update = useUpdateListing(userId ?? undefined);

  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('vegetables');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (listing && !seeded) {
      setTitle(listing.title);
      setQuantity(listing.quantity ?? '');
      setDescription(listing.description ?? '');
      setCategory(listing.category);
      setSeeded(true);
    }
  }, [listing, seeded]);

  if (isLoading) return <View style={styles.screen} />;
  // Fail closed when signed out too: RLS would reject the update, but a
  // rejected UPDATE returns 0 rows and no error, so the save would look like it
  // worked. Never render the form without a matching owner.
  if (!listing || listing.owner_id !== userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔒" title="Can't edit this" subtitle="You can only edit your own listings." />
      </View>
    );
  }

  const save = () => {
    if (!title.trim()) {
      Alert.alert('Add a title', 'A listing needs a title.');
      return;
    }
    update.mutate(
      { listingId: listing.id, title: title.trim(), description: description.trim(), quantity: quantity.trim(), category },
      {
        onSuccess: () => router.back(),
        onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again.'),
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Cherry tomatoes" />
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="About 2 lbs / a full basket" />
        <Text style={styles.label}>Category</Text>
        <View style={styles.catWrap}>
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <Pressable key={c.id} onPress={() => setCategory(c.id)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.emoji} {c.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field label="Details" value={description} onChangeText={setDescription} placeholder="Picked this morning, porch pickup…" multiline numberOfLines={3} style={styles.multiline} />
        <Button label="Save changes" onPress={save} loading={update.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 16 },
  label: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8, fontFamily: fonts.semibold },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontFamily: fonts.semibold },
  chipTextActive: { color: Colors.textInverse },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
