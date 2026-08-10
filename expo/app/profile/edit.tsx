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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, LocateFixed } from 'lucide-react-native';
import { Avatar, Button, Field, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyProfile, useUpdateProfile } from '@/lib/db';
import { pickImages, uploadListingImages } from '@/lib/images';
import { currentLocationFields } from '@/lib/location';
import { hardinessZoneForZip } from '@/lib/zone';

/**
 * Profile editor — parity with the web account view (name, photo, city, state,
 * ZIP). ZIP is private: it is never shown to other neighbours and is only used
 * to derive a growing zone and to centre nearby search.
 */
export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const profile = useMyProfile(userId ?? undefined);
  const update = useUpdateProfile(userId ?? undefined);

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (profile.data && !seeded) {
      setName(profile.data.name ?? '');
      setCity(profile.data.city ?? '');
      setState(profile.data.state ?? '');
      setZip(profile.data.zip_code ?? '');
      setAvatarUrl(profile.data.avatar_url);
      setSeeded(true);
    }
  }, [profile.data, seeded]);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in first" subtitle="You need an account to edit your profile." />
      </View>
    );
  }
  if (profile.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const zone = hardinessZoneForZip(zip);

  const pickAvatar = async () => {
    // pickImages re-encodes to JPEG, stripping the photo's camera/GPS metadata
    // before anything reaches the public bucket.
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

  // One-tap fill from the device's location. Permission is requested only on
  // tap; the result just populates the fields — the user still reviews, can
  // edit anything, and must tap Save. Raw coordinates are never stored on the
  // profile; failure leaves whatever was already typed untouched.
  const fillFromCurrentLocation = async () => {
    setLocating(true);
    try {
      const res = await currentLocationFields();
      if (!res.ok) {
        Alert.alert(
          res.reason === 'denied' ? 'Location permission needed' : 'Couldn’t find your location',
          res.reason === 'denied'
            ? 'Allow location for Gnome in iOS Settings, or type your town below. Nothing was changed.'
            : 'Check your connection and try again, or type your town below. Nothing was changed.',
        );
        return;
      }
      if (res.city) setCity(res.city);
      if (res.state) setState(res.state);
      if (res.zip) setZip(res.zip);
    } finally {
      setLocating(false);
    }
  };

  const save = () => {
    if (!name.trim()) {
      Alert.alert('Add your name', 'Neighbours see this name on your listings.');
      return;
    }
    const cleanZip = zip.trim();
    if (cleanZip && !/^\d{5}$/.test(cleanZip)) {
      Alert.alert('Check your ZIP', 'Enter a 5-digit ZIP code, or leave it blank.');
      return;
    }
    update.mutate(
      {
        name: name.trim(),
        city: city.trim() || null,
        state: state.trim().toUpperCase() || null,
        zip_code: cleanZip || null,
        avatar_url: avatarUrl,
      },
      {
        onSuccess: () => router.back(),
        onError: (e: any) => Alert.alert('Could not save', e?.message ?? 'Try again.'),
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={styles.avatarRow}
          onPress={pickAvatar}
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
        >
          <Avatar uri={avatarUrl} name={name} size={72} />
          <View style={styles.avatarBtn}>
            {busy ? <ActivityIndicator color={Colors.primary} /> : <Camera size={18} color={Colors.primary} />}
            <Text style={styles.avatarBtnText}>{avatarUrl ? 'Change photo' : 'Add photo'}</Text>
          </View>
        </Pressable>

        <Field label="Display name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />

        <Pressable
          onPress={() => void fillFromCurrentLocation()}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel="Use current location to fill in city, state, and ZIP code"
          style={[styles.locateBtn, locating && { opacity: 0.6 }]}
        >
          {locating ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <LocateFixed size={16} color={Colors.primary} />
          )}
          <Text style={styles.locateBtnText}>
            {locating ? 'Finding your town…' : 'Use current location'}
          </Text>
        </Pressable>

        <Field label="Town or city (optional)" value={city} onChangeText={setCity} placeholder="City" autoCapitalize="words" />
        <Field label="State (optional)" value={state} onChangeText={setState} placeholder="State" autoCapitalize="characters" autoCorrect={false} maxLength={2} />
        <Field
          label="ZIP code (private)"
          value={zip}
          onChangeText={setZip}
          placeholder="ZIP Code"
          keyboardType="number-pad"
          maxLength={5}
        />

        <View style={styles.privacyNote}>
          <Text style={styles.privacyTitle}>🔒 What neighbours can see</Text>
          <Text style={styles.privacyText}>
            Your name, photo, and town are public. Your ZIP code is private — it is never shown
            to other neighbours. Gnome uses it only to work out your growing zone and to centre
            your nearby search. Listings always show an approximate area, never your address.
          </Text>
          {zone ? <Text style={styles.zoneText}>🌱 Growing zone {zone} (from your ZIP)</Text> : null}
        </View>

        <Button label="Save profile" onPress={save} loading={update.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 16 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20, minHeight: 44 },
  avatarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  avatarBtnText: { color: Colors.primary, fontSize: 14, fontFamily: fonts.bold },
  locateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '0D',
    marginBottom: 16,
  },
  locateBtnText: { color: Colors.primary, fontSize: 14, fontFamily: fonts.bold },
  privacyNote: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 20,
    gap: 6,
  },
  privacyTitle: { fontSize: 13, color: Colors.text, fontFamily: fonts.bold },
  privacyText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, fontFamily: fonts.regular },
  zoneText: { fontSize: 13, color: Colors.primary, fontFamily: fonts.semibold, marginTop: 2 },
});
