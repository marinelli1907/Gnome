import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { nativeWebUrl } from '@/lib/links';
import {
  acceptCurrentAccountPolicies,
  loadAccountPolicyVersions,
  loadAccountReadiness,
  readinessLabel,
  resendEmailVerification,
  verifyEmailCode,
  type AccountPolicyVersions,
  type AccountReadiness,
} from '@/lib/accountReadiness';

export default function AccountReadyScreen() {
  const insets = useSafeAreaInsets();
  const { session, userId } = useAuth();
  const [readiness, setReadiness] = useState<AccountReadiness | null>(null);
  const [policies, setPolicies] = useState<AccountPolicyVersions | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [consent, setConsent] = useState({
    age18: false,
    terms: false,
    privacy: false,
    marketplaceRules: false,
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [r, p] = await Promise.all([loadAccountReadiness(), loadAccountPolicyVersions()]);
    setReadiness(r);
    setPolicies(p);
  }, []);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = setTimeout(() => setEmailCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [emailCooldown]);

  useEffect(() => {
    if (!userId) return;
    refresh()
      .catch((e: any) => Alert.alert('Could not load status', e?.message ?? 'Please try again.'))
      .finally(() => setLoading(false));
  }, [refresh, userId]);

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
      Alert.alert('Done', success);
    } catch (e: any) {
      Alert.alert('Could not update', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔑" title="Sign in first" subtitle="You need an account before completing readiness." />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const items = [
    ['verified_email', readiness?.email_verified],
    ['age_18', readiness?.age_confirmed],
    ['terms', readiness?.terms_accepted],
    ['privacy', readiness?.privacy_accepted],
    ['marketplace_rules', readiness?.marketplace_rules_accepted],
  ] as const;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>One quick account update</Text>
      <Text style={styles.sub}>
        Posting, Market setup, requests, messaging, and pickup details require a ready account.
      </Text>

      <View style={styles.statusBox}>
        {items.map(([key, ok]) => (
          <View key={key} style={styles.statusRow}>
            <Text style={styles.statusLabel}>{readinessLabel(key)}</Text>
            <Text style={[styles.statusValue, { color: ok ? Colors.success : Colors.error }]}>
              {ok ? 'Done' : 'Needed'}
            </Text>
          </View>
        ))}
      </View>

      {!readiness?.email_verified && (
        <View style={styles.block}>
          <Button
            label={emailCooldown > 0 ? `Resend in ${emailCooldown}s` : (busy ? 'Sending…' : 'Email me a verification code')}
            variant="secondary"
            loading={busy}
            disabled={!session?.user.email || emailCooldown > 0}
            onPress={() => void run(async () => {
              await resendEmailVerification(session?.user.email ?? '');
              setEmailCooldown(60);
            }, 'Verification code sent.')}
          />
          <Field
            label="Email verification code"
            value={emailCode}
            onChangeText={setEmailCode}
            placeholder="6-digit code"
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            label={busy ? 'Verifying…' : 'Verify email'}
            loading={busy}
            disabled={!session?.user.email || emailCode.trim().length < 6}
            onPress={() => void run(
              () => verifyEmailCode(session?.user.email ?? '', emailCode),
              'Email verified.',
            )}
          />
        </View>
      )}

      {policies && (
        <View style={styles.block}>
          <Text style={styles.notice}>{policies.marketplace_notice}</Text>
          <View style={styles.linkRow}>
            <Button label="Terms" variant="ghost" onPress={() => void Linking.openURL(nativeWebUrl('/terms'))} />
            <Button label="Privacy" variant="ghost" onPress={() => void Linking.openURL(nativeWebUrl('/privacy'))} />
            <Button label="Marketplace Rules" variant="ghost" onPress={() => void Linking.openURL(nativeWebUrl('/trust'))} />
          </View>
          {(!readiness?.age_confirmed || !readiness?.terms_accepted || !readiness?.privacy_accepted || !readiness?.marketplace_rules_accepted) && (
            <View style={styles.consentBox}>
              {[
                ['age18', 'I confirm I am 18 or older'],
                ['terms', 'I accept the Terms of Service'],
                ['privacy', 'I accept the Privacy Policy'],
                ['marketplaceRules', 'I accept the Marketplace Rules'],
              ].map(([key, label]) => (
                <View key={key} style={styles.consentRow}>
                  <Text style={styles.consentLabel}>{label}</Text>
                  <Switch
                    value={consent[key as keyof typeof consent]}
                    onValueChange={(value) => setConsent((current) => ({ ...current, [key]: value }))}
                    disabled={busy}
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                  />
                </View>
              ))}
              <Button
                label={busy ? 'Saving…' : 'Save confirmations'}
                loading={busy}
                disabled={!consent.age18 || !consent.terms || !consent.privacy || !consent.marketplaceRules}
                onPress={() => void run(() => acceptCurrentAccountPolicies(consent), 'Current policies accepted.')}
              />
            </View>
          )}
        </View>
      )}

      {readiness?.account_ready && (
        <Text style={styles.ready}>Your account is ready.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, gap: 14 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: Colors.text },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  statusBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  statusLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: Colors.text },
  statusValue: { fontFamily: fonts.bold, fontSize: 13 },
  block: { gap: 10 },
  notice: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  linkRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  consentBox: { gap: 10 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  consentLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: Colors.text },
  ready: { fontFamily: fonts.bold, fontSize: 15, color: Colors.success, textAlign: 'center', marginTop: 4 },
});
