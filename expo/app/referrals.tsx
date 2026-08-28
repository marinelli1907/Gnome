import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Gift, Share2, Sparkles } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type Program = {
  code: string;
  share_url: string;
  qualified_sellers: number;
  pending_referrals: number;
  featured_listing_credits: number;
  featured_market_boosts: number;
  next_milestone: number | null;
};

export default function ReferralsScreen() {
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ code?: string; source?: string }>();
  const [program, setProgram] = useState<Program | null>(null);
  const [code, setCode] = useState(typeof params.code === 'string' ? params.code : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: loadError } = await supabase.rpc('my_referral_program');
    if (loadError) setError('Your referral details could not load. Nothing changed.');
    else setProgram(data as Program);
  }, [userId]);

  const apply = useCallback(async (incoming: string) => {
    if (!userId || !incoming.trim()) return;
    setBusy(true); setError(null);
    const source = params.source === 'market_qr' ? 'MARKET_QR' : 'APP_LINK';
    const { error: captureError } = await supabase.rpc('capture_my_referral', {
      p_code: incoming.trim().toUpperCase(), p_source: source, p_market: null,
    });
    setBusy(false);
    if (captureError) {
      const message = /SELF_REFERRAL/.test(captureError.message)
        ? 'You cannot use your own referral code.'
        : /ALREADY_ATTRIBUTED/.test(captureError.message)
          ? 'This account already has a referral source.'
          : 'That referral code could not be applied.';
      setError(message);
      return;
    }
    Alert.alert('Referral saved', 'Rewards are issued only after the referred seller qualifies.');
    await load();
  }, [load, params.source, userId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (userId && typeof params.code === 'string' && params.code.trim()) void apply(params.code);
  }, [apply, params.code, userId]);

  if (!userId) return <View style={styles.center}><Text style={styles.body}>Sign in to use referrals.</Text></View>;
  if (!program && !error) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  const share = () => program && Share.share({
    title: 'Join me on Gnome',
    message: `Sell local food and garden goods with me on Gnome: ${program.share_url}`,
    url: program.share_url,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.icon}><Gift size={24} color={Colors.primary} /></View>
        <Text style={styles.title}>Grow Gnome together</Text>
        <Text style={styles.body}>Share your link. Seller rewards begin only when a referred seller publishes a legitimate public Sell listing.</Text>
      </View>

      {program ? (
        <View style={styles.card}>
          <Text style={styles.label}>YOUR REFERRAL CODE</Text>
          <Text style={styles.code}>{program.code}</Text>
          <Pressable style={styles.primaryButton} onPress={share} accessibilityRole="button">
            <Share2 size={18} color="#FFFFFF" /><Text style={styles.primaryText}>Share referral link</Text>
          </Pressable>
        </View>
      ) : null}

      {program ? (
        <View style={styles.metrics}>
          <Metric value={program.qualified_sellers} label="Qualified sellers" />
          <Metric value={program.pending_referrals} label="Pending" />
          <Metric value={program.featured_listing_credits} label="Listing credits" />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Launch rewards</Text>
        <Reward title="Each qualified seller" detail="1 Featured Listing credit for each seller. Seller referrers also receive 1." />
        <Reward title="3 qualified sellers" detail="3 additional Featured Listing credits." />
        <Reward title="5 qualified sellers" detail="30 days Pro plus 5 Featured Listing credits." />
        <Reward title="10 qualified sellers" detail="90 days Pro, 10 Featured Listing credits, and 1 Featured Market Boost." />
        <Text style={styles.note}>Buyer rewards are tracked but deferred until the referrer becomes a seller, so buyers never receive a useless seller-only credit. Milestones at 25 and 50 are tracked without automatic rewards.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Have a referral code?</Text>
        <View style={styles.entryRow}>
          <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="GN..." autoCapitalize="characters" autoCorrect={false} style={styles.input} />
          <Pressable style={[styles.applyButton, (!code.trim() || busy) && styles.disabled]} disabled={!code.trim() || busy} onPress={() => void apply(code)}>
            <Text style={styles.applyText}>{busy ? 'Saving' : 'Apply'}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {program?.featured_market_boosts ? (
        <View style={styles.card}>
          <View style={styles.rewardRow}><Sparkles size={18} color={Colors.primary} /><Text style={styles.heading}>Market Boost available</Text></View>
          <Text style={styles.body}>Your boost features your Market for seven days. Activation is explicit and never changes billing.</Text>
          <Pressable style={styles.secondaryButton} onPress={async () => {
            const { error: e } = await supabase.rpc('redeem_market_featured_boost');
            if (e) Alert.alert('Could not activate boost', e.message); else { Alert.alert('Market Boost scheduled'); void load(); }
          }}><Text style={styles.secondaryText}>Activate Market Boost</Text></Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}
function Reward({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.reward}><Text style={styles.rewardTitle}>{title}</Text><Text style={styles.rewardDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: 16, paddingBottom: 40, gap: 12 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  hero: { alignItems: 'center', paddingVertical: 10, gap: 7 }, icon: { width: 48, height: 48, borderRadius: 8, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontFamily: 'Fraunces_700Bold', color: Colors.text }, body: { fontSize: 14, lineHeight: 20, textAlign: 'center', fontFamily: fonts.regular, color: Colors.textSecondary },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 8, padding: 16, gap: 10 }, label: { fontSize: 11, fontFamily: fonts.bold, color: Colors.textSecondary },
  code: { fontSize: 20, fontFamily: fonts.bold, color: Colors.text, letterSpacing: 0 }, primaryButton: { minHeight: 46, borderRadius: 8, paddingHorizontal: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary }, primaryText: { color: '#FFFFFF', fontFamily: fonts.bold },
  metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, minHeight: 82, borderRadius: 8, borderWidth: 1, borderColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface }, metricValue: { fontSize: 21, fontFamily: fonts.bold, color: Colors.text }, metricLabel: { fontSize: 11, textAlign: 'center', fontFamily: fonts.regular, color: Colors.textSecondary },
  heading: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text }, reward: { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 9 }, rewardTitle: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.text }, rewardDetail: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: Colors.textSecondary }, note: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: Colors.textSecondary },
  entryRow: { flexDirection: 'row', gap: 8 }, input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, fontFamily: fonts.regular, color: Colors.text }, applyButton: { minWidth: 80, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary }, applyText: { color: '#FFFFFF', fontFamily: fonts.bold }, disabled: { opacity: 0.45 }, error: { color: Colors.error, fontFamily: fonts.regular, fontSize: 13 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, secondaryButton: { minHeight: 44, borderWidth: 1, borderColor: Colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, secondaryText: { color: Colors.primary, fontFamily: fonts.bold },
});
