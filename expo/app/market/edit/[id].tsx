import React, { useEffect, useState } from 'react';
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
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, ChevronRight } from 'lucide-react-native';
import { Avatar, Button, Field, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useUpdateMarket } from '@/lib/db';
import { pickImages, uploadListingImages } from '@/lib/images';

export default function EditMarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(id);
  const update = useUpdateMarket(userId ?? undefined);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (market.data && !seeded) {
      setName(market.data.name);
      setDescription(market.data.description ?? '');
      setAvatarUrl(market.data.avatar_url);
      setSeeded(true);
    }
  }, [market.data, seeded]);

  if (market.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }
  if (!market.data || market.data.owner_id !== userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔒" title="Can't edit this Market" subtitle="You can only edit your own Market." />
      </View>
    );
  }

  const pickAvatar = async () => {
    if (!userId) return;
    const picked = await pickImages({ selectionLimit: 1 });
    if (!picked.length) return;
    setBusy(true);
    try {
      const urls = await uploadListingImages(userId, picked);
      if (urls[0]) setAvatarUrl(urls[0]);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Name your Market', 'Give your Market a name.');
      return;
    }
    update.mutate(
      { marketId: market.data!.id, name: name.trim(), description: description.trim(), avatar_url: avatarUrl },
      {
        onSuccess: () => router.back(),
        onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again.'),
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>This is your corner of the neighborhood — name it, add a photo, and tell folks what you grow.</Text>

        <Pressable style={styles.avatarRow} onPress={pickAvatar}>
          <Avatar uri={avatarUrl} name={name} size={72} />
          <View style={styles.avatarBtn}>
            {busy ? <ActivityIndicator color={Colors.primary} /> : <Camera size={18} color={Colors.primary} />}
            <Text style={styles.avatarBtnText}>{avatarUrl ? 'Change photo' : 'Add photo'}</Text>
          </View>
        </Pressable>

        <Field label="Market name" value={name} onChangeText={setName} placeholder="Your Market name" />
        <Field
          label="About your Market (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="Backyard veg in Lyndhurst — tomatoes, herbs, too much zucchini."
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <Button label="Save Market" onPress={save} loading={update.isPending} />

        <Text style={styles.toolsTitle}>Market tools</Text>
        <Pressable
          style={styles.toolLink}
          onPress={() => router.push('/market/payment-settings')}
          accessibilityRole="button"
          accessibilityLabel="Payment methods"
        >
          <Text style={styles.toolLinkText}>Payment methods</Text>
          <ChevronRight size={18} color={Colors.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.toolLink, { marginTop: 10 }]}
          onPress={() => router.push('/market/pickup-settings')}
          accessibilityRole="button"
          accessibilityLabel="Pickup availability"
        >
          <Text style={styles.toolLinkText}>Pickup availability</Text>
          <ChevronRight size={18} color={Colors.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.toolLink, { marginTop: 10 }]}
          onPress={() => router.push('/market/delivery-settings')}
          accessibilityRole="button"
          accessibilityLabel="Delivery"
        >
          <Text style={styles.toolLinkText}>Delivery</Text>
          <ChevronRight size={18} color={Colors.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.toolLink, { marginTop: 10 }]}
          onPress={() => router.push('/market/pickups')}
          accessibilityRole="button"
          accessibilityLabel="Pickups"
        >
          <Text style={styles.toolLinkText}>Pickups</Text>
          <ChevronRight size={18} color={Colors.textSecondary} />
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 16 },
  intro: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 18, fontFamily: fonts.regular },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  avatarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatarBtnText: { color: Colors.primary, fontSize: 14, fontFamily: fonts.bold },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  toolsTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginTop: 26, marginBottom: 10 },
  toolLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  toolLinkText: { fontSize: 15, color: Colors.text, fontFamily: fonts.semibold },
});
