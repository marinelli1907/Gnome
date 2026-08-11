// AI Listing Assistant — photo → draft → the NORMAL post editor (prefilled).
// The AI never publishes; it hands a draft to the same editor every listing
// goes through, so plan limits, taxonomy, and compliance all still run.
// Images are resized/re-encoded on device (EXIF/GPS stripped) and analyzed in
// memory server-side — never stored. Entitlement comes from the backend's
// resolved plan (paid OR complimentary Grower/Farm/Sponsor).
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface Draft {
  candidate_name: string;
  confidence: number;
  alternatives: string[];
  suggested_title: string;
  suggested_description: string;
  suggested_unit: string;
  suggested_price_range: string;
  suggested_price_cents: number;
  suggested_listing_type: string;
  possible_quantity: string;
  seller_questions: string[];
  multiple_items: { name: string; search_terms: string[] }[];
}
interface TaxCandidate { id: string; path: string; name: string; score: number }

function useEntitlements(uid?: string) {
  return useQuery({
    queryKey: ['entitlements', uid],
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_plan_entitlements');
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) ?? null;
    },
  });
}

export default function AiListingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const ent = useEntitlements(userId ?? undefined);
  const [busy, setBusy] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [candidates, setCandidates] = useState<TaxCandidate[]>([]);
  const [pickedNode, setPickedNode] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const eligible = !!ent.data?.ai_listing_assistant;

  const capture = async (fromCamera: boolean) => {
    setFailed(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to continue.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (res.canceled || !res.assets[0]) return;

    setBusy(true);
    try {
      // Re-encode: strips EXIF/GPS and bounds the payload.
      const small = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      setPhotoUri(small.uri);
      const { data, error } = await supabase.functions.invoke('analyze-listing-photo', {
        body: { image_base64: small.base64, media_type: 'image/jpeg' },
      });
      if (error) throw new Error(error.message ?? 'ANALYZE_FAILED');
      if (data?.error) throw new Error(data.message ?? data.error);
      setDraft(data.draft as Draft);
      setCandidates((data.taxonomy_candidates ?? []) as TaxCandidate[]);
      setPickedNode((data.taxonomy_candidates?.[0]?.id as string) ?? null);
      if ((data.draft?.confidence ?? 0) < 0.3) {
        setFailed('Gnome couldn’t confidently identify this item.');
        setDraft(null);
      }
    } catch (e: any) {
      setDraft(null);
      setFailed(
        /PLAN_REQUIRED/.test(e?.message) ? 'The AI Listing Assistant is a Grower & Farm feature.'
        : /DAILY_LIMIT/.test(e?.message) ? 'Daily AI limit reached — try again tomorrow.'
        : 'Gnome couldn’t confidently identify this item.',
      );
    } finally {
      setBusy(false);
    }
  };

  const useDraft = () => {
    if (!draft) return;
    router.replace({
      pathname: '/(tabs)/post',
      params: {
        type: draft.suggested_listing_type || 'sale',
        aiTitle: draft.suggested_title,
        aiDescription: draft.suggested_description,
        aiPrice: draft.suggested_price_cents ? (draft.suggested_price_cents / 100).toFixed(2) : '',
        aiUnit: draft.suggested_unit,
        aiNode: pickedNode ?? '',
        quantity: draft.possible_quantity,
      },
    });
  };

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="✨" title="Sign in first" subtitle="The AI Listing Assistant is tied to your Market." />
      </View>
    );
  }

  if (ent.data && !eligible) {
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <EmptyState
          emoji="🔒"
          title="AI Listing Assistant"
          subtitle="Snap a photo and Gnome drafts the listing for you — included with Grower and Farm plans."
        >
          <Button label="See plans" onPress={() => router.push('/upgrade')} style={{ marginTop: 14 }} />
        </EmptyState>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
      <Text style={styles.heading}>✨ Photo to listing</Text>
      <Text style={styles.sub}>
        Take a photo of what you grew or made. Gnome identifies it, finds the right
        category, and drafts the listing — you review and publish.
      </Text>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="📷 Take photo" onPress={() => void capture(true)} disabled={busy} style={{ flex: 1 }} />
        <Button label="🖼 Library" variant="secondary" onPress={() => void capture(false)} disabled={busy} style={{ flex: 1 }} />
      </View>

      {busy && (
        <View style={[styles.center, { marginTop: 30 }]}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.busyText}>Gnome is looking at your photo…</Text>
        </View>
      )}

      {photoUri && !busy && (
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
      )}

      {failed && !busy && (
        <View style={styles.failBox}>
          <Text style={styles.failText}>{failed}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Button label="Try another photo" variant="secondary" onPress={() => void capture(true)} style={{ flex: 1 }} />
            <Button label="Create manually" onPress={() => router.replace('/(tabs)/post')} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {draft && !busy && (
        <View style={styles.draftBox}>
          <Text style={styles.draftName}>
            {draft.candidate_name}
            <Text style={styles.conf}>  {Math.round(draft.confidence * 100)}% sure</Text>
          </Text>
          <Text style={styles.draftTitle}>{draft.suggested_title}</Text>
          <Text style={styles.draftDesc}>{draft.suggested_description}</Text>
          <Text style={styles.meta}>
            {draft.suggested_price_range ? `Suggested: ${draft.suggested_price_range}` : ''}
            {draft.possible_quantity ? ` · ${draft.possible_quantity}` : ''}
          </Text>

          {candidates.length > 0 && (
            <>
              <Text style={styles.section}>Category</Text>
              <View style={styles.chips}>
                {candidates.map((c) => (
                  <Pressable key={c.id} onPress={() => setPickedNode(c.id)}
                    style={[styles.chip, pickedNode === c.id && styles.chipActive]}>
                    <Text style={[styles.chipText, pickedNode === c.id && styles.chipTextActive]}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {candidates.length === 0 && (
            <Text style={styles.meta}>No category match — you’ll pick one in the editor.</Text>
          )}

          {draft.multiple_items.length > 0 && (
            <Text style={styles.meta}>
              Also spotted: {draft.multiple_items.map((m) => m.name).join(', ')} — post those separately after this one.
            </Text>
          )}

          {draft.seller_questions.length > 0 && (
            <Text style={styles.questions}>🤔 {draft.seller_questions[0]}</Text>
          )}

          <Button label="Use this draft →" onPress={useDraft} style={{ marginTop: 14 }} />
          <Text style={styles.footnote}>
            You’ll review everything before it goes live — Gnome never publishes for you.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 25, fontFamily: 'Fraunces_700Bold', color: Colors.text },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: 16, lineHeight: 20, fontFamily: fonts.regular },
  busyText: { marginTop: 10, fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary },
  preview: { width: '100%', height: 200, borderRadius: 14, marginTop: 16 },
  failBox: { marginTop: 16, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.borderLight },
  failText: { fontSize: 14.5, fontFamily: fonts.semibold, color: Colors.text },
  draftBox: { marginTop: 16, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: Colors.primary },
  draftName: { fontSize: 18, fontFamily: fonts.bold, color: Colors.primary },
  conf: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary },
  draftTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginTop: 8 },
  draftDesc: { fontSize: 14, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 4, lineHeight: 20 },
  meta: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginTop: 8 },
  section: { fontSize: 12, fontFamily: fonts.bold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderLight },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  questions: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 10, fontStyle: 'italic' },
  footnote: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textTertiary, textAlign: 'center', marginTop: 10 },
});
