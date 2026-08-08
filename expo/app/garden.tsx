import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { askGardenPlanner, type PlannerTurn } from '@/lib/ai';
import { logEvent } from '@/lib/db';
import { supabase } from '@/lib/supabase';

const STARTERS = [
  'What should I plant right now?',
  'Plan a 4×8 raised bed for salads',
  'What can I still start from seed this month?',
  'Low-effort crops for a beginner?',
];

export default function GardenPlannerScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [location, setLocation] = useState('');
  const [turns, setTurns] = useState<PlannerTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Prefill from the profile's town (set at signup / in settings).
  useEffect(() => {
    if (!userId) return;
    void supabase
      .from('profiles')
      .select('city,state')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.city) setLocation((l) => l || `${data.city}, ${data.state ?? 'OH'}`);
      });
  }, [userId]);

  const ask = async (question: string, photo?: { base64: string; mediaType: string }) => {
    const q = question.trim();
    if (!q || busy) return;
    if (!location.trim()) {
      setError('First tell the planner where your garden is (city + state).');
      return;
    }
    setError(null);
    const next: PlannerTurn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const reply = await askGardenPlanner({
        location: location.trim(),
        messages: next,
        imageBase64: photo?.base64,
        mediaType: photo?.mediaType,
      });
      setTurns([...next, { role: 'assistant', content: reply }]);
      void logEvent('garden_planner_used', { userId: userId ?? undefined, metadata: { q } });
    } catch (e: any) {
      setError(e?.message ?? 'The planner hit a snag — try again.');
      setTurns(turns);
      setInput(q);
    } finally {
      setBusy(false);
    }
  };

  // 🌿 Check a plant: snap or pick a photo → the planner diagnoses it.
  const checkPlant = async () => {
    if (busy) return;
    if (!location.trim()) {
      setError('First tell the planner where your garden is (city + state).');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.4, // keep the upload small; plenty for a diagnosis
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) {
      setError('Couldn’t read that photo — try another one.');
      return;
    }
    void ask('📷 What’s wrong with this plant? Please diagnose from the photo.', {
      base64: asset.base64,
      mediaType: asset.mimeType ?? 'image/jpeg',
    });
  };

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🌱"
          title="Garden Planner"
          subtitle="Sign in and get a planting plan for your exact town and week."
        >
          <Button label="Sign in / Sign up" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={styles.locationRow}>
        <Text style={styles.locationLabel}>My garden is in</Text>
        <TextInput
          style={styles.locationInput}
          value={location}
          onChangeText={setLocation}
          placeholder="Richmond Heights, OH"
          placeholderTextColor={Colors.textTertiary}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.log}
        contentContainerStyle={styles.logContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {turns.length === 0 && (
          <View style={styles.starters}>
            <Text style={styles.startersTitle}>Ask me anything about your garden 🌱</Text>
            {STARTERS.map((s) => (
              <Pressable key={s} style={styles.starter} onPress={() => void ask(s)}>
                <Text style={styles.starterText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {turns.map((t, i) => (
          <View
            key={i}
            style={[styles.bubble, t.role === 'user' ? styles.bubbleUser : styles.bubbleAI]}
          >
            <Text style={t.role === 'user' ? styles.bubbleUserText : styles.bubbleAIText}>
              {t.content}
            </Text>
          </View>
        ))}
        {busy && (
          <View style={[styles.bubble, styles.bubbleAI]}>
            <Text style={[styles.bubbleAIText, styles.thinking]}>
              Checking your zone and the calendar… 🌱
            </Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.inputRow}>
        <Pressable
          style={[styles.plantBtn, busy && styles.sendDisabled]}
          disabled={busy}
          onPress={() => void checkPlant()}
        >
          <Text style={styles.plantBtnText}>🌿</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={turns.length === 0 ? 'What should I plant?' : 'Ask a follow-up…'}
          placeholderTextColor={Colors.textTertiary}
          onSubmitEditing={() => void ask(input)}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable
          style={[styles.send, (!input.trim() || busy) && styles.sendDisabled]}
          disabled={!input.trim() || busy}
          onPress={() => void ask(input)}
        >
          <Text style={styles.sendText}>{busy ? '…' : 'Ask'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  locationLabel: { fontFamily: fonts.semibold, color: Colors.textSecondary, fontSize: 13 },
  locationInput: {
    flex: 1,
    fontFamily: fonts.semibold,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
  },
  log: { flex: 1 },
  logContent: { padding: 16, gap: 10 },
  starters: { gap: 10, paddingTop: 8 },
  startersTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: Colors.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  starter: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  starterText: { fontFamily: fonts.semibold, color: Colors.primary, fontSize: 14 },
  bubble: { borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '92%' },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: Colors.chatBubbleUser },
  bubbleAI: { alignSelf: 'flex-start', backgroundColor: Colors.chatBubbleAI },
  bubbleUserText: { fontFamily: fonts.medium, color: Colors.chatBubbleUserText, fontSize: 15, lineHeight: 21 },
  bubbleAIText: { fontFamily: fonts.medium, color: Colors.chatBubbleAIText, fontSize: 15, lineHeight: 22 },
  thinking: { color: Colors.textSecondary, fontStyle: 'italic' },
  error: { fontFamily: fonts.semibold, color: Colors.error, fontSize: 13, paddingTop: 4 },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  send: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { fontFamily: fonts.bold, color: Colors.textInverse, fontSize: 15 },
  plantBtn: {
    width: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plantBtnText: { fontSize: 20 },
});
