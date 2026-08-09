import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { LogOut } from 'lucide-react-native';
import { Avatar, Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyBlocks, useSendFeedback, useUnblockUser } from '@/lib/db';

export default function SettingsScreen() {
  const router = useRouter();
  const { userId, session, signOut } = useAuth();
  const blocks = useMyBlocks(userId ?? undefined);
  const unblock = useUnblockUser(userId ?? undefined);
  const feedback = useSendFeedback(userId ?? undefined);
  const [feedbackText, setFeedbackText] = useState('');

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="⚙️" title="Settings" subtitle="Sign in to manage your account.">
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  const sendFeedback = () => {
    feedback.mutate(feedbackText, {
      onSuccess: () => {
        setFeedbackText('');
        Alert.alert('Thanks! 🌱', 'Your feedback helps make Gnome better for the neighborhood.');
      },
      onError: (e: any) => Alert.alert('Could not send', e?.message ?? 'Try again.'),
    });
  };

  const onUnblock = (blockedId: string, name: string) => {
    Alert.alert(`Unblock ${name}?`, 'You’ll see their listings again and can exchange requests.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', onPress: () => unblock.mutate(blockedId) },
    ]);
  };

  const blocked = blocks.data ?? [];
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Send feedback</Text>
      <Text style={styles.sectionHint}>
        Found something confusing or broken? Tell us — this goes straight to the builders.
      </Text>
      <TextInput
        style={styles.feedbackInput}
        value={feedbackText}
        onChangeText={setFeedbackText}
        placeholder="What’s working? What isn’t?"
        placeholderTextColor={Colors.textTertiary}
        multiline
        maxLength={2000}
      />
      <Button
        label="Send feedback"
        onPress={sendFeedback}
        loading={feedback.isPending}
        disabled={!feedbackText.trim()}
      />

      <Text style={styles.sectionTitle}>Blocked neighbors</Text>
      {blocked.length === 0 ? (
        <Text style={styles.sectionHint}>
          Nobody blocked. You can block a neighbor from their listing or Market page.
        </Text>
      ) : (
        blocked.map((b) => (
          <View key={b.blocked_id} style={styles.blockRow}>
            <Avatar uri={b.blocked?.avatar_url} name={b.blocked?.name} size={36} />
            <Text style={styles.blockName}>{b.blocked?.name ?? 'A neighbor'}</Text>
            <Pressable
              onPress={() => onUnblock(b.blocked_id, b.blocked?.name ?? 'this neighbor')}
              hitSlop={8}
            >
              <Text style={styles.unblock}>Unblock</Text>
            </Pressable>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.accountCard}>
        <Text style={styles.accountEmail}>{session?.user?.email ?? '—'}</Text>
        <Pressable style={styles.signOut} onPress={() => signOut()}>
          <LogOut size={16} color={Colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.about}>
        Gnome v{version} · Fresh from nearby{'\n'}
        Sellers are responsible for following local food laws.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: Colors.text, marginTop: 26, marginBottom: 6 },
  sectionHint: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 19, marginBottom: 10 },
  feedbackInput: { minHeight: 90,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    textAlignVertical: 'top',
    marginBottom: 12, fontFamily: fonts.regular },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 10,
    marginBottom: 8,
  },
  blockName: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  unblock: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.primary, padding: 4 },
  accountCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 14,
    gap: 10,
  },
  accountEmail: { fontSize: 15, fontFamily: fonts.medium, color: Colors.text },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  signOutText: { color: Colors.error, fontFamily: fonts.bold, fontSize: 14 },
  about: {
    marginTop: 32,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: fonts.regular,
    color: Colors.textTertiary,
    lineHeight: 18,
  },
});
