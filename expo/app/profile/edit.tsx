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
import { supabase } from '@/lib/supabase';
import { pickImages, uploadListingImages } from '@/lib/images';
import { currentLocationFields } from '@/lib/location';
import { hardinessZoneForZip } from '@/lib/zone';

/**
 * Profile editor — parity with the web account view (photo, city, state, ZIP)
 * plus the private contact details.
 *
 * The public display name is DERIVED ("First L.") by save_onboarding_contact
 * from a first and last name that live in user_private_contact, so a full legal
 * name can never reach the world-readable profiles row. This screen is also the
 * place someone who skipped the welcome chat fills those details in later —
 * skipping is always recoverable.
 */
export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const profile = useMyProfile(userId ?? undefined);
  const update = useUpdateProfile(userId ?? undefined);

  const [name, setName] = useState('');          // derived, read-only preview
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
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
      void supabase.rpc('my_onboarding_state').then(({ data }) => {
        if (!data) return;
        setFirstName(data.first_name ?? '');
        setLastName(data.last_name ?? '');
        setContactEmail(data.contact_email ?? '');
        setPhone(data.phone ?? '');
      });
      setCity(profile.data.city ?? '');
      setState(profile.data.state ?? '');
      setZip(profile.data.zip_code ?? '');
      setAvatarUrl(profile.data.avatar_url);
      setSeeded(true);
    }
  }, [profile.data, seeded]);

  const saveDetails = async () => {
    if (savingDetails) return;
    setSavingDetails(true);
    try {
      const { data, error } = await supabase.rpc('save_onboarding_contact', {
        p_first_name: firstName, p_last_name: lastName,
        p_email: contactEmail, p_phone: phone || null,
        p_complete: !!(firstName.trim() && lastName.trim() && contactEmail.trim()),
      });
      if (error) throw error;
      if (data?.display_name) setName(data.display_name);
      Alert.alert('Saved', 'Your details are up to date.');
    } catch (e: any) {
      const m = String(e?.message ?? '');
      Alert.alert(
        'Couldn’t save',
        /INVALID_EMAIL/.test(m) ? 'That email doesn’t look right.'
        : /INVALID_PHONE/.test(m) ? 'That phone number doesn’t look right.'
        : 'Please try again.',
      );
    } finally {
      setSavingDetails(false);
    }
  };

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
      Alert.alert('Add your name', 'Save your first and last name above first.');
      return;
    }
    const cleanZip = zip.trim();
    if (cleanZip && !/^\d{5}$/.test(cleanZip)) {
      Alert.alert('Check your ZIP', 'Enter a 5-digit ZIP code, or leave it blank.');
      return;
    }
    update.mutate(
      {
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

        <Field label="First name" value={firstName} onChangeText={setFirstName}
          placeholder="First" autoCapitalize="words" />
        <Field label="Last name" value={lastName} onChangeText={setLastName}
          placeholder="Last" autoCapitalize="words" />
        <Field label="Email for notifications" value={contactEmail} onChangeText={setContactEmail}
          placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
        <Field label="Mobile" value={phone} onChangeText={setPhone}
          placeholder="For pickup and delivery coordination" keyboardType="phone-pad" />
        <Text style={styles.hint}>
          Neighbours only ever see {name || 'your first name and last initial'}. Your full last
          name, email, and phone stay private. A verified mobile number is required for posting,
          requests, messages, and Market setup.
        </Text>
        <Button
          label={savingDetails ? 'Saving…' : 'Save details'}
          onPress={saveDetails}
          disabled={savingDetails}
        />
        <Button
          label="One quick account update"
          variant="secondary"
          onPress={() => router.push('/account-ready' as never)}
        />

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
  hint: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary, fontFamily: fonts.regular, marginBottom: 10 },
});
