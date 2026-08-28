import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';

const CALLBACK_TIMEOUT_MS = 15_000;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { loading, recoveryMode, session } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), CALLBACK_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (recoveryMode) {
      router.replace('/sign-in');
      return;
    }
    if (!loading && session) router.replace('/');
  }, [loading, recoveryMode, router, session]);

  if (timedOut) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>That link could not be completed</Text>
        <Text style={styles.body}>Request a new password reset link and open it on this device.</Text>
        <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator color={Colors.primary} size="large" />
      <Text style={styles.title}>Finishing sign in</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 28,
    backgroundColor: Colors.background,
  },
  title: {
    color: Colors.text,
    fontFamily: fonts.bold,
    fontSize: 22,
    textAlign: 'center',
  },
  body: {
    color: Colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
});
