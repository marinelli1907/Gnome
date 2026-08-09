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
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'lucide-react-native';
import { Avatar, Button, Field, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useUpdateMarket } from '@/lib/db';
import { uploadListingImages } from '@/lib/images';

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
        <EmptyState emoji="🔒" title="Can't edit this garden" subtitle="You can only edit your own Market." />
      </View>
    );
  }

  const pickAvatar = async () => {
    if (!userId) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    });
    if (result.canceled) return;
    setBusy(true);
    try {
      const urls = await uploadListingImages(userId, result.assets);
      if (urls[0]) setAvatarUrl(urls[0]);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Name your garden', 'Give your Market a name.');
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

        <Field label="Garden name" value={name} onChangeText={setName} placeholder="Maria's Garden" />
        <Field
          label="About your garden (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="Backyard veg in Lyndhurst — tomatoes, herbs, too much zucchini."
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <Button label="Save garden" onPress={save} loading={update.isPending} />
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
});
