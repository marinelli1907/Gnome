import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, MapPin, ShieldCheck, Store } from 'lucide-react-native';
import { Button, EmptyState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { loadAccountReadiness, type AccountReadiness } from '@/lib/accountReadiness';
import { useAuth } from '@/providers/AuthProvider';

type Preview = {
  case_id: string; business_name: string; status: string; total_drafts: number;
  ready: number; needs_info: number; needs_compliance: number; expires_at: string;
};

type ClaimedCase = {
  id: string; business_name: string; market_profile: Record<string, unknown>;
  market_model: 'RESERVATION' | 'SELF_SERVE' | 'BOTH';
  location_mode: 'PRIVATE_PICKUP' | 'APPROXIMATE' | 'PUBLIC_STAND';
};

const first = <T,>(data: T | T[] | null): T | null => Array.isArray(data) ? data[0] ?? null : data;

export default function ClaimMarketScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { userId, setNewPassword } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [readiness, setReadiness] = useState<AccountReadiness | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<ClaimedCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [useExistingLogin, setUseExistingLogin] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [model, setModel] = useState<ClaimedCase['market_model']>('RESERVATION');
  const [locationMode, setLocationMode] = useState<ClaimedCase['location_mode']>('APPROXIMATE');
  const [standAddress, setStandAddress] = useState('');
  const [standConsent, setStandConsent] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    const { data, error } = await supabase.rpc('concierge_claim_preview', { p_token: token });
    if (error) throw error;
    const p = first<Preview>(data as Preview | Preview[] | null);
    setPreview(p);
    if (userId) {
      const { error: verifyError } = await supabase.rpc('verify_concierge_email', { p_token: token });
      if (verifyError) {
        const message = String(verifyError.message ?? 'Could not verify the invited mailbox.');
        setVerificationError(/INVITE_EMAIL_MISMATCH/.test(message)
          ? 'This invitation belongs to a different email address.'
          : /EMAIL_OTP_SESSION_REQUIRED/.test(message)
            ? 'Open the sign-in link in the invitation email on this device.'
            : message);
        return;
      }
      setVerificationError(null);
      setReadiness(await loadAccountReadiness());
      if (p) {
        const { data: rows } = await supabase.from('seller_concierge_cases')
          .select('id,business_name,market_profile,market_model,location_mode').eq('id', p.case_id).maybeSingle();
        if (rows) {
          const row = rows as ClaimedCase;
          setClaimed(row);
          const profile = row.market_profile ?? {};
          setName(String(profile.name ?? row.business_name));
          setCity(String(profile.city ?? ''));
          setState(String(profile.state ?? ''));
          setModel(row.market_model);
          setLocationMode(row.location_mode);
          setStandAddress(String(profile.public_stand_address ?? ''));
        }
      }
    }
  }, [token, userId]);

  useEffect(() => {
    load().catch(() => setPreview(null)).finally(() => setLoading(false));
  }, [load]);

  const claim = async () => {
    if (!token || busy) return;
    if (!useExistingLogin) {
      if (password.length < 8 || password !== passwordAgain) {
        Alert.alert('Choose your password', 'Use at least 8 characters and enter the same password twice.');
        return;
      }
    }
    setBusy(true);
    try {
      if (!useExistingLogin) await setNewPassword(password);
      const { data, error } = await supabase.rpc('claim_prepared_market', { p_token: token });
      if (error) throw error;
      const result = data as { case_id: string; business_name: string };
      Alert.alert('Market claimed', 'Your prepared products are private drafts. Nothing was published.');
      const { data: row } = await supabase.from('seller_concierge_cases')
        .select('id,business_name,market_profile,market_model,location_mode').eq('id', result.case_id).single();
      if (row) {
        const c = row as ClaimedCase;
        setClaimed(c);
        setName(String(c.market_profile?.name ?? c.business_name));
        setCity(String(c.market_profile?.city ?? ''));
        setState(String(c.market_profile?.state ?? ''));
        setModel(c.market_model);
        setLocationMode(c.location_mode);
      }
      // Keep the one-time preview in memory after claim. The invite is now
      // consumed by design, so asking the preview RPC again would correctly
      // return no row and hide the seller-review form we just unlocked.
    } catch (error: any) {
      const message = String(error?.message ?? 'Could not claim this Market.');
      Alert.alert('Claim not completed', /INVITE_EMAIL_MISMATCH/.test(message)
        ? 'Sign in with the email address that received this invitation.'
        : /ACCOUNT_NOT_READY/.test(message) ? 'Complete the account update first.' : message);
    } finally { setBusy(false); }
  };

  const confirmMarket = async () => {
    if (!claimed || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('confirm_concierge_market', {
      p_case: claimed.id,
      p_profile: {
        name: name.trim(), city: city.trim(), state: state.trim().toUpperCase(),
        market_model: model, location_mode: locationMode,
        public_stand_address: locationMode === 'PUBLIC_STAND' ? standAddress.trim() : undefined,
      },
      p_public_stand_consent: locationMode === 'PUBLIC_STAND' && standConsent,
    });
    setBusy(false);
    if (error) {
      Alert.alert('Could not save', /PUBLIC_STAND_CONSENT_REQUIRED/.test(error.message)
        ? 'Enter the public stand address and confirm that you want it shown.' : error.message);
      return;
    }
    Alert.alert('Market details saved', 'You remain in control. Review each listing draft before publishing.');
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!token || !preview) return <View style={styles.center}><EmptyState emoji="🔒" title="Invitation unavailable" subtitle="This link is invalid, expired, or already used." /></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Store size={25} color={Colors.primary} /></View>
        <Text style={styles.title}>{preview.business_name}</Text>
        <Text style={styles.sub}>Gnome has prepared your Market.</Text>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>Ready for review</Text>
        <Text style={styles.summaryBig}>{preview.total_drafts} product drafts</Text>
        <Text style={styles.summaryLine}>{preview.ready} ready · {preview.needs_info} need your information · {preview.needs_compliance} need compliance questions</Text>
        <Text style={styles.privateNote}>Nothing is public until you review and publish it.</Text>
      </View>

      {!userId ? (
        <View style={styles.block}>
          <ShieldCheck size={22} color={Colors.primary} />
          <Text style={styles.blockTitle}>Verify your account</Text>
          <Text style={styles.body}>Open the invitation email to sign in, or use the invited email address here.</Text>
          <Button label="Sign in or verify email" onPress={() => router.push('/sign-in')} />
        </View>
      ) : verificationError ? (
        <View style={styles.block}>
          <ShieldCheck size={22} color={Colors.primary} />
          <Text style={styles.blockTitle}>Verification needs attention</Text>
          <Text style={styles.body}>{verificationError}</Text>
          <Button label="Switch account" onPress={() => router.push('/sign-in')} />
        </View>
      ) : !readiness?.account_ready ? (
        <View style={styles.block}>
          <ShieldCheck size={22} color={Colors.primary} />
          <Text style={styles.blockTitle}>One quick account update</Text>
          <Text style={styles.body}>Verify your email, confirm you are 18+, and accept the current policies before claiming.</Text>
          <Button label="Complete account update" onPress={() => router.push('/account-ready')} />
        </View>
      ) : !claimed ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Your sign-in credentials</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Use my current Gnome password</Text>
            <Switch value={useExistingLogin} onValueChange={setUseExistingLogin} trackColor={{ false: Colors.border, true: Colors.primary }} />
          </View>
          {!useExistingLogin ? <>
            <Field label="Choose password" value={password} onChangeText={setPassword} secureTextEntry />
            <Field label="Confirm password" value={passwordAgain} onChangeText={setPasswordAgain} secureTextEntry />
            <Text style={styles.privateNote}>Only Supabase Auth receives this password. Gnome staff and Boon cannot see it.</Text>
          </> : null}
          <Button label="Claim my Market" loading={busy} onPress={() => void claim()} />
        </View>
      ) : (
        <>
          <View style={styles.block}>
            <View style={styles.doneRow}><Check size={18} color={Colors.success} /><Text style={styles.blockTitle}>Market claimed</Text></View>
            <Text style={styles.body}>Confirm the prepared Market details. You can edit or remove every draft before publishing.</Text>
            <Field label="Market name" value={name} onChangeText={setName} />
            <View style={styles.twoCol}><View style={{ flex: 1 }}><Field label="City" value={city} onChangeText={setCity} /></View><View style={{ width: 86 }}><Field label="State" value={state} onChangeText={setState} maxLength={2} /></View></View>

            <Text style={styles.fieldLabel}>How this Market works</Text>
            <Segmented values={['RESERVATION','SELF_SERVE','BOTH']} selected={model} onSelect={(value) => setModel(value as ClaimedCase['market_model'])} />
            <Text style={styles.fieldLabel}>Location privacy</Text>
            <Segmented values={['PRIVATE_PICKUP','APPROXIMATE','PUBLIC_STAND']} selected={locationMode} onSelect={(value) => { setLocationMode(value as ClaimedCase['location_mode']); setStandConsent(false); }} />
            {locationMode === 'PUBLIC_STAND' ? (
              <View style={styles.consentBox}>
                <MapPin size={19} color={Colors.primary} />
                <TextInput style={styles.addressInput} value={standAddress} onChangeText={setStandAddress} placeholder="Public stand or business address" placeholderTextColor={Colors.textTertiary} />
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>I want this stand address displayed publicly on Gnome</Text>
                  <Switch value={standConsent} onValueChange={setStandConsent} trackColor={{ false: Colors.border, true: Colors.primary }} />
                </View>
              </View>
            ) : null}
            <Button label="Confirm Market details" loading={busy} onPress={() => void confirmMarket()} />
          </View>
          <Button label="Review product drafts" onPress={() => router.replace('/(tabs)/ai')} />
        </>
      )}
    </ScrollView>
  );
}

function Segmented({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (value: string) => void }) {
  return <View style={styles.segments}>{values.map((value) => <Pressable key={value} onPress={() => onSelect(value)} style={[styles.segment, selected === value && styles.segmentActive]}><Text style={[styles.segmentText, selected === value && styles.segmentTextActive]}>{value.replaceAll('_',' ')}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: 24 },
  content: { padding: 20, paddingBottom: 48, gap: 14 }, hero: { alignItems: 'center', paddingVertical: 8 },
  heroIcon: { width: 48, height: 48, borderRadius: 8, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Fraunces_700Bold', fontSize: 25, color: Colors.text, textAlign: 'center', marginTop: 10 },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary, marginTop: 3 },
  summary: { borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 8, backgroundColor: Colors.surface, padding: 15 },
  summaryTitle: { fontFamily: fonts.bold, textTransform: 'uppercase', color: Colors.primary, fontSize: 12 },
  summaryBig: { fontFamily: fonts.bold, color: Colors.text, fontSize: 19, marginTop: 4 },
  summaryLine: { fontFamily: fonts.regular, color: Colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
  privateNote: { fontFamily: fonts.regular, color: Colors.textTertiary, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  block: { borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 8, backgroundColor: Colors.surface, padding: 15, gap: 11 },
  blockTitle: { fontFamily: fonts.bold, color: Colors.text, fontSize: 16 }, body: { fontFamily: fonts.regular, color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, switchLabel: { flex: 1, fontFamily: fonts.semibold, color: Colors.text, fontSize: 13 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, twoCol: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontFamily: fonts.semibold, color: Colors.text, fontSize: 13, marginTop: 2 },
  segments: { flexDirection: 'row', gap: 6 }, segment: { flex: 1, minHeight: 40, paddingHorizontal: 5, borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' }, segmentText: { fontFamily: fonts.semibold, color: Colors.textSecondary, fontSize: 10.5, textAlign: 'center' }, segmentTextActive: { color: Colors.primary },
  consentBox: { borderWidth: 1, borderColor: Colors.primary + '55', borderRadius: 8, padding: 11, gap: 9, backgroundColor: Colors.primary + '08' },
  addressInput: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.surface, paddingHorizontal: 11, color: Colors.text, fontFamily: fonts.regular, fontSize: 13.5 },
});
