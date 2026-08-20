import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
} from 'react-native';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Field } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { nativeWebUrl } from '@/lib/links';

export default function SignInScreen() {
  const router = useRouter();
  const {
    signIn, signUp, requestEmailCode, verifyEmailCode,
    requestPasswordReset, setNewPassword, recoveryMode, clearRecoveryMode,
    signInWithGoogle, signInWithApple, configured,
  } = useAuth();
  const [mode, setMode] = useState<'in' | 'up' | 'code' | 'forgot' | 'reset'>('up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Ask the auth server which providers are actually enabled instead of
  // hardcoding it — a disabled provider must never render a button that fails
  // in front of a user (or an App Review reviewer).
  const [providers, setProviders] = useState<{ google: boolean; apple: boolean }>({
    google: false,
    apple: false,
  });

  // Arriving from a password-reset email puts us in a recovery session.
  useEffect(() => {
    if (recoveryMode) setMode('reset');
  }, [recoveryMode]);

  useEffect(() => {
    if (!configured) return;
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => r.json())
      .then((s) => {
        const external = s?.external ?? {};
        setProviders({ google: external.google === true, apple: external.apple === true });
        if (external.apple === true && Platform.OS === 'ios') {
          AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
        }
      })
      .catch(() => {
        // Unknown → keep the buttons hidden; email/password always works.
      });
  }, [configured]);

  const onApple = async () => {
    if (!configured) {
      Alert.alert('Supabase not connected', 'Add your Supabase keys to .env to enable accounts.');
      return;
    }
    try {
      await signInWithApple();
      if (router.canGoBack()) router.back();
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return; // user dismissed the sheet
      Alert.alert('Apple sign-in failed', e?.message ?? 'Please try again.');
    }
  };

  const onGoogle = async () => {
    if (!configured) {
      Alert.alert('Supabase not connected', 'Add your Supabase keys to .env to enable accounts.');
      return;
    }
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      if (router.canGoBack()) router.back();
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message ?? 'Please try again.');
    } finally {
      setGoogleBusy(false);
    }
  };

  // Email-code flow — the same door as the website, so code-only web users
  // can sign into the app without ever setting a password.
  const sendCode = async () => {
    if (!configured) {
      Alert.alert('Supabase not connected', 'Add your Supabase keys to .env to enable accounts.');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Missing info', 'Enter your email address.');
      return;
    }
    setBusy(true);
    try {
      await requestEmailCode(email.trim());
      setCodeSent(true);
    } catch (e: any) {
      Alert.alert('Couldn’t send the code', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (code.trim().length < 6) {
      Alert.alert('Check the code', 'Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    try {
      await verifyEmailCode(email.trim(), code.trim());
      if (router.canGoBack()) router.back();
    } catch (e: any) {
      Alert.alert('Code didn’t match', e?.message ?? 'Check the code and try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    if (!configured) {
      Alert.alert('Supabase not connected', 'Add your Supabase keys to .env to enable accounts.');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Missing info', 'Enter your email address.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Deliberately swallowed: revealing that a send failed (or succeeded)
      // for a specific address is an account-enumeration oracle.
    } finally {
      setBusy(false);
      // Same copy either way — we never confirm whether an account exists.
      Alert.alert(
        'Check your email',
        'If an account exists for that address, we just sent a link to reset the password. Open it on this device.',
        [{ text: 'OK', onPress: () => setMode('in') }],
      );
    }
  };

  const submitNewPassword = async () => {
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await setNewPassword(password);
      clearRecoveryMode();
      Alert.alert('Password updated', 'You’re signed in.', [
        { text: 'OK', onPress: () => { if (router.canGoBack()) router.back(); } },
      ]);
    } catch (e: any) {
      const raw = e?.message ?? '';
      Alert.alert(
        'Could not update password',
        /expired|invalid|session/i.test(raw)
          ? 'That reset link has expired or was already used. Request a new one.'
          : raw || 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!configured) {
      Alert.alert('Supabase not connected', 'Add your Supabase keys to .env to enable accounts.');
      return;
    }
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'up') {
        const { needsConfirm } = await signUp(email.trim(), password, name.trim() || 'Neighbor');
        if (needsConfirm) {
          Alert.alert('Check your inbox', 'Confirm your email, then sign in.');
        }
      } else {
        await signIn(email.trim(), password);
      }
      if (router.canGoBack()) router.back();
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.emoji}>🍅</Text>
        <Text style={styles.title}>
          {mode === 'reset' ? 'Set a new password'
            : mode === 'forgot' ? 'Reset your password'
            : mode === 'code' ? 'Sign in with a code'
            : mode === 'up' ? 'Join your neighborhood' : 'Welcome back'}
        </Text>
        <Text style={styles.subtitle}>
          Share your garden surplus and grab what neighbors have to spare.
        </Text>

        {!configured && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Supabase isn&apos;t connected yet. Add EXPO_PUBLIC_SUPABASE_URL and
              EXPO_PUBLIC_SUPABASE_ANON_KEY to a .env file to enable sign-in.
            </Text>
          </View>
        )}

        {mode === 'up' && (
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            autoCapitalize="words"
          />
        )}
        {mode !== 'reset' && (
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
        {mode === 'reset' && (
          <Field
            label="New password (8+ characters)"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
          />
        )}
        {mode !== 'code' && mode !== 'forgot' && mode !== 'reset' && (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
          />
        )}
        {mode === 'code' && codeSent && (
          <Field
            label="6-digit code from your email"
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            autoCorrect={false}
          />
        )}

        {mode === 'reset' ? (
          <Button label="Save new password" onPress={submitNewPassword} loading={busy} />
        ) : mode === 'forgot' ? (
          <>
            <Button label="Email me a reset link" onPress={sendReset} loading={busy} />
            <Pressable onPress={() => setMode('in')} style={styles.toggle}>
              <Text style={styles.toggleText}>← Back to sign in</Text>
            </Pressable>
          </>
        ) : mode === 'code' ? (
          codeSent ? (
            <>
              <Button label="Verify code" onPress={submitCode} loading={busy} />
              <Pressable onPress={sendCode} disabled={busy} style={styles.toggle}>
                <Text style={styles.toggleText}>Send a new code</Text>
              </Pressable>
            </>
          ) : (
            <Button label="Email me a code" onPress={sendCode} loading={busy} />
          )
        ) : (
          <Button
            label={mode === 'up' ? 'Create account' : 'Sign in'}
            onPress={submit}
            loading={busy}
          />
        )}

        {mode === 'in' && (
          <Pressable onPress={() => setMode('forgot')} style={styles.toggle}>
            <Text style={styles.toggleText}>Forgot your password?</Text>
          </Pressable>
        )}

        {(mode === 'in' || mode === 'up') && (
          <Pressable onPress={() => { setMode('code'); setCodeSent(false); setCode(''); }} style={styles.toggle}>
            <Text style={styles.toggleText}>Email me a code instead — no password needed</Text>
          </Pressable>
        )}

        {(providers.google || appleAvailable) && (
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>
        )}

        {providers.google && (
          <>
            <Pressable
              onPress={onGoogle}
              disabled={googleBusy || busy}
              style={({ pressed }) => [
                styles.googleBtn,
                (googleBusy || busy) && styles.googleBtnDisabled,
                pressed && styles.googleBtnPressed,
              ]}
            >
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.googleText}>
                {googleBusy ? 'Connecting…' : 'Continue with Google'}
              </Text>
            </Pressable>
          </>
        )}

        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={12}
            style={styles.appleBtn}
            onPress={onApple}
          />
        )}

        <View style={styles.legalRow}>
          <Text style={styles.legalText}>By continuing you agree to our </Text>
          <Pressable onPress={() => Linking.openURL(nativeWebUrl('/terms'))} accessibilityRole="link">
            <Text style={styles.legalLink}>Terms</Text>
          </Pressable>
          <Text style={styles.legalText}> and </Text>
          <Pressable onPress={() => Linking.openURL(nativeWebUrl('/privacy'))} accessibilityRole="link">
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.legalText}>.</Text>
        </View>

        <Pressable
          onPress={() => setMode(mode === 'code' ? 'in' : mode === 'up' ? 'in' : 'up')}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>
            {mode === 'code'
              ? '← Use a password instead'
              : mode === 'up'
                ? 'Already have an account? Sign in'
                : 'New here? Create an account'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 32 },
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: 8, fontFamily: fonts.regular },
  title: { fontSize: 28, fontFamily: 'Fraunces_700Bold', color: Colors.text, textAlign: 'center' },
  subtitle: { fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 21, fontFamily: fonts.regular },
  notice: {
    backgroundColor: Colors.warning + '22',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  noticeText: { color: Colors.text, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textSecondary, fontSize: 13, fontFamily: fonts.semibold },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  googleBtnDisabled: { opacity: 0.5 },
  googleBtnPressed: { opacity: 0.7 },
  googleG: { fontSize: 18, color: '#4285F4', fontFamily: fonts.bold },
  googleText: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold },
  appleBtn: { height: 50, marginTop: 10 },
  toggle: { marginTop: 18, alignItems: 'center' },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 12,
  },
  legalText: { color: Colors.textSecondary, fontSize: 12, fontFamily: fonts.regular },
  legalLink: { color: Colors.primary, fontSize: 12, fontFamily: fonts.bold, minHeight: 22 },
  toggleText: { color: Colors.primary, fontSize: 14, fontFamily: fonts.semibold },
});
