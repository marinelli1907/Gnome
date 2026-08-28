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
import { Camera, ChevronRight, ImageIcon } from 'lucide-react-native';
import { Avatar, Button, Field, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMarket, useMyFollowerCount, useUpdateMarket } from '@/lib/db';
import { pickImages, uploadListingImages } from '@/lib/images';

const THEMES = [
  { key: 'garden', label: 'Garden', color: Colors.gardenGreen },
  { key: 'harvest', label: 'Harvest', color: Colors.marketOrange },
  { key: 'herb', label: 'Herb', color: Colors.gardenGreenInteractive },
  { key: 'farm_stand', label: 'Farm stand', color: Colors.gnomeRed },
  { key: 'minimal', label: 'Simple', color: Colors.backgroundSecondary },
] as const;

function themeColor(theme: string): string {
  return THEMES.find((item) => item.key === theme)?.color ?? Colors.gardenGreen;
}

export default function EditMarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(id);
  const update = useUpdateMarket(userId ?? undefined);
  // Aggregate only (0119): a count, never follower identities.
  const followers = useMyFollowerCount(userId ?? undefined);

  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [theme, setTheme] = useState('garden');
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState<'avatar' | 'banner' | null>(null);

  useEffect(() => {
    if (market.data && !seeded) {
      setName(market.data.name);
      setTagline(market.data.tagline ?? '');
      setDescription(market.data.description ?? '');
      setAvatarUrl(market.data.avatar_url);
      setBannerUrl(market.data.banner_url ?? null);
      setTheme(market.data.theme ?? 'garden');
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

  const pickMarketImage = async (kind: 'avatar' | 'banner') => {
    if (!userId) return;
    const picked = await pickImages({ selectionLimit: 1 });
    if (!picked.length) return;
    setBusy(kind);
    try {
      const urls = await uploadListingImages(userId, picked);
      if (urls[0] && kind === 'avatar') setAvatarUrl(urls[0]);
      if (urls[0] && kind === 'banner') setBannerUrl(urls[0]);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Name your Market', 'Give your Market a name.');
      return;
    }
    update.mutate(
      {
        marketId: market.data!.id,
        name: name.trim(),
        tagline: tagline.trim() || null,
        description: description.trim(),
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
        theme,
      },
      {
        onSuccess: () => router.back(),
        onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again.'),
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Make this page feel like your stand. Your photos and story appear in the app and on the Gnome website.</Text>
        {typeof followers.data === 'number' && followers.data > 0 && (
          <Text style={styles.followers}>
            🌻 {followers.data} {followers.data === 1 ? 'person follows' : 'people follow'} your Market
          </Text>
        )}

        <Pressable
          style={[styles.coverPreview, { backgroundColor: themeColor(theme) }]}
          onPress={() => void pickMarketImage('banner')}
          accessibilityRole="button"
          accessibilityLabel={bannerUrl ? 'Change Market cover photo' : 'Add Market cover photo'}
        >
          {bannerUrl ? <Image source={{ uri: bannerUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <View style={styles.coverAction}>
            {busy === 'banner' ? <ActivityIndicator color={Colors.textInverse} /> : <ImageIcon size={18} color={Colors.textInverse} />}
            <Text style={styles.coverActionText}>{bannerUrl ? 'Change cover' : 'Add cover photo'}</Text>
          </View>
        </Pressable>

        <Pressable style={styles.avatarRow} onPress={() => void pickMarketImage('avatar')}>
          <Avatar uri={avatarUrl} name={name} size={76} />
          <View style={styles.avatarBtn}>
            {busy === 'avatar' ? <ActivityIndicator color={Colors.primary} /> : <Camera size={18} color={Colors.primary} />}
            <Text style={styles.avatarBtnText}>{avatarUrl ? 'Change profile photo' : 'Add profile photo'}</Text>
          </View>
        </Pressable>

        <Field label="Market name" value={name} onChangeText={setName} placeholder="Your Market name" />
        <Field
          label="Tagline (optional)"
          value={tagline}
          onChangeText={setTagline}
          placeholder="Fresh from our backyard to yours"
          maxLength={80}
        />
        <Field
          label="About your Market (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="Backyard veg in Lyndhurst — tomatoes, herbs, too much zucchini."
          multiline
          numberOfLines={3}
          style={styles.multiline}
          maxLength={500}
        />

        <Text style={styles.themeLabel}>Cover style</Text>
        <View style={styles.themeRow}>
          {THEMES.map((item) => {
            const selected = theme === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTheme(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.themeChoice, selected && styles.themeChoiceActive]}
              >
                <View style={[styles.themeSwatch, { backgroundColor: item.color }]} />
                <Text style={[styles.themeText, selected && styles.themeTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

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
          accessibilityLabel="Hours and visit scheduling"
        >
          <Text style={styles.toolLinkText}>Hours & visit scheduling</Text>
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
        <Pressable
          style={[styles.toolLink, { marginTop: 10 }]}
          onPress={() => router.push('/market/drops')}
          accessibilityRole="button"
          accessibilityLabel="Market Drops"
        >
          <Text style={styles.toolLinkText}>Market Drops</Text>
          <ChevronRight size={18} color={Colors.textSecondary} />
        </Pressable>
        <Pressable
          style={[styles.toolLink, { marginTop: 10 }]}
          onPress={() => router.push('/market/bundles')}
          accessibilityRole="button"
          accessibilityLabel="Gift Baskets"
        >
          <Text style={styles.toolLinkText}>Gift Baskets</Text>
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
  followers: { fontSize: 14, color: Colors.text, fontFamily: fonts.semibold, marginTop: -8, marginBottom: 18 },
  coverPreview: {
    height: 150,
    alignSelf: 'stretch',
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  coverAction: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7,
    backgroundColor: 'rgba(34,34,34,0.78)', paddingHorizontal: 12, paddingVertical: 9,
    margin: 10, borderRadius: 6,
  },
  coverActionText: { color: Colors.textInverse, fontSize: 13, fontFamily: fonts.bold },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  avatarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatarBtnText: { color: Colors.primary, fontSize: 14, fontFamily: fonts.bold },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  themeLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 8 },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  themeChoice: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  themeChoiceActive: { borderColor: Colors.primary, borderWidth: 2 },
  themeSwatch: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: Colors.border },
  themeText: { color: Colors.textSecondary, fontFamily: fonts.semibold, fontSize: 12.5 },
  themeTextActive: { color: Colors.text },
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
