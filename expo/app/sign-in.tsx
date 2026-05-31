import React, { useState } from 'react';
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
import { useAuth } from '@/providers/AuthProvider';
import { Button, Field } from '@/components/ui';
import Colors from '@/constants/colors';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signUp, configured } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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
        await signUp(email.trim(), password, name.trim() || 'Neighbor');
        Alert.alert('Check your inbox', 'Confirm your email if required, then sign in.');
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
          {mode === 'up' ? 'Join your neighborhood' : 'Welcome back'}
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
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />

        <Button
          label={mode === 'up' ? 'Create account' : 'Sign in'}
          onPress={submit}
          loading={busy}
        />

        <Pressable onPress={() => setMode(mode === 'up' ? 'in' : 'up')} style={styles.toggle}>
          <Text style={styles.toggleText}>
            {mode === 'up' ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 32 },
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.text, textAlign: 'center' },
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
  toggle: { marginTop: 18, alignItems: 'center' },
  toggleText: { color: Colors.primary, fontWeight: '600', fontSize: 14 },
});
