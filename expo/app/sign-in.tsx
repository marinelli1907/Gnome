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
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Field } from '@/components/ui';
import Colors from '@/constants/colors';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signUp, requestEmailCode, verifyEmailCode, signInWithGoogle, signInWithApple, configured } = useAuth();
  const [mode, setMode] = useState<'in' | 'up' | 'code'>('up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Google/Apple need their providers enabled in the Supabase dashboard first.
  // Until then the buttons would only produce errors — keep them hidden.
  const OAUTH_READY = false;

  useEffect(() => {
    if (OAUTH_READY && Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {mode === 'code' ? 'Sign in with a code' : mode === 'up' ? 'Join your neighborhood' : 'Welcome back'}
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
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {mode !== 'code' && (
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

        {mode === 'code' ? (
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

        {mode !== 'code' && (
          <Pressable onPress={() => { setMode('code'); setCodeSent(false); setCode(''); }} style={styles.toggle}>
            <Text style={styles.toggleText}>Email me a code instead — no password needed</Text>
          </Pressable>
        )}

        {OAUTH_READY && (
          <>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

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
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontFamily: 'Fraunces_700Bold', color: Colors.text, textAlign: 'center' },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 21,
  },
  notice: {
    backgroundColor: Colors.warning + '22',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  noticeText: { color: Colors.text, fontSize: 13, lineHeight: 19 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
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
  googleG: { fontSize: 18, fontWeight: '800', color: '#4285F4' },
  googleText: { fontSize: 15, fontWeight: '700', color: Colors.text },
  appleBtn: { height: 50, marginTop: 10 },
  toggle: { marginTop: 18, alignItems: 'center' },
  toggleText: { color: Colors.primary, fontWeight: '600', fontSize: 14 },
});
