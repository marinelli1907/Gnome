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
import { ChevronRight } from 'lucide-react-native';
import { Button, Field, EmptyState } from '@/components/ui';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useListing, useUpdateListing } from '@/lib/db';
import {
  breadcrumb,
  legacyCategoryFor,
  parseServerError,
  useTaxonomy,
} from '@/lib/taxonomy';
import { alertListingWriteError, alertUnderReview, isUnderReview, safeErrorText } from '@/lib/screening';

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading } = useListing(id);
  const update = useUpdateListing(userId ?? undefined);
  const taxonomy = useTaxonomy();
  const index = taxonomy.data;

  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  // Legacy listings keep their backfilled node untouched unless the seller
  // deliberately re-categorizes (changing the node re-runs the server gate).
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  const [nodeTouched, setNodeTouched] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (listing && !seeded) {
      setTitle(listing.title);
      setQuantity(listing.quantity ?? '');
      setDescription(listing.description ?? '');
      setTaxNodeId(listing.taxonomy_node_id ?? null);
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

  const selectedNode = index && taxNodeId ? index.byId.get(taxNodeId) ?? null : null;
  const isPlot = listing.listing_type === 'plot';

  const save = () => {
    if (!title.trim()) {
      Alert.alert('Add a title', 'A listing needs a title.');
      return;
    }
    update.mutate(
      {
        listingId: listing.id,
        title: title.trim(),
        description: description.trim(),
        quantity: quantity.trim(),
        category:
          nodeTouched && selectedNode && index
            ? legacyCategoryFor(index, selectedNode)
            : listing.category,
        ...(nodeTouched ? { taxonomyNodeId: selectedNode?.id ?? null } : {}),
      },
      {
        onSuccess: (saved) => {
          // An edit re-runs the screening trigger, and a re-screen can park a
          // listing that was public a second ago. Going straight back with no
          // feedback would leave the seller believing it is still on sale.
          if (isUnderReview(saved)) {
            alertUnderReview(saved, { onClose: () => router.back() });
            return;
          }
          router.back();
        },
        onError: (e: any) => {
          if (alertListingWriteError(e?.message)) return;
          const err = parseServerError(e?.message);
          if (err?.code === 'COMPLIANCE_BLOCKED') {
            Alert.alert(err.title, err.message);
          } else {
            Alert.alert('Could not save', safeErrorText(e?.message, 'Try again.'));
          }
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Cherry tomatoes" />
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="About 2 lbs / a full basket" />
        {!isPlot && (
          <>
            <Text style={styles.label}>Category</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selectedNode && index
                  ? `Category: ${breadcrumb(index, selectedNode)}. Tap to change.`
                  : 'Choose a category'
              }
              onPress={() => setPickerOpen(true)}
              style={[styles.selector, !selectedNode && styles.selectorEmpty]}
            >
              <Text
                style={[styles.selectorText, !selectedNode && styles.selectorPlaceholder]}
                numberOfLines={1}
              >
                {selectedNode && index ? breadcrumb(index, selectedNode) : 'Choose a category…'}
              </Text>
              <ChevronRight size={18} color={Colors.textTertiary} />
            </Pressable>
          </>
        )}
        <Field label="Details" value={description} onChangeText={setDescription} placeholder="Picked this morning, porch pickup…" multiline numberOfLines={3} style={styles.multiline} />
        <Button label="Save changes" onPress={save} loading={update.isPending} />
      </ScrollView>
      {index ? (
        <TaxonomyPicker
          visible={pickerOpen}
          index={index}
          selectedId={taxNodeId}
          mode="sell"
          onSelect={(node) => {
            setTaxNodeId(node?.id ?? null);
            setNodeTouched(true);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 16 },
  label: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8, fontFamily: fonts.semibold },
  selector: {
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
  selectorEmpty: { borderColor: Colors.border, backgroundColor: Colors.surface, borderStyle: 'dashed' },
  selectorText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  selectorPlaceholder: { color: Colors.textTertiary, fontFamily: fonts.regular },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
