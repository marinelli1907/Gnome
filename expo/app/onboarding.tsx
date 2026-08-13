// Welcome chat — a gnome collects the few profile details Gnome needs instead
// of showing a cold form. Shown once, right after sign-up.
//
// Never a trap: "Skip for now" is always available, and if AI is paused or
// unconfigured the screen falls back to a plain form that writes through the
// SAME validated RPC. Contact details go to user_private_contact (owner-only);
// only "First L." is ever shown to other neighbors.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type Msg = { role: 'user' | 'assistant'; content: string };
type State = {
  completed: boolean; display_name: string | null;
  first_name: string | null; last_name: string | null;
  phone: string | null; contact_email: string | null;
};

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scroller = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [state, setState] = useState<State | null>(null);

  // Plain-form fallback fields.
  const [form, setForm] = useState({ first: '', last: '', email: '', phone: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const finish = useCallback(() => router.replace('/(tabs)'), [router]);

  const send = useCallback(async (history: Msg[]) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('gnome-onboarding', {
        body: { messages: history },
      });
      if (error) throw error;
      if (data?.state) setState(data.state as State);
      if (data?.ai_available === false) { setAiAvailable(false); return; }
      if (typeof data?.reply === 'string' && data.reply) {
        setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
      }
      if (data?.state?.completed) setTimeout(finish, 1400);
    } catch {
      setAiAvailable(false);
    } finally {
      setBusy(false);
    }
  }, [finish]);

  useEffect(() => {
    if (!isSupabaseConfigured) { setAiAvailable(false); setBusy(false); return; }
    void send([]);
  }, [send]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    await send(next);
  };

  const saveForm = async () => {
    setFormError(null);
    if (!form.first.trim() || !form.last.trim() || !form.email.trim()) {
      setFormError('First name, last name, and email are needed.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('save_onboarding_contact', {
        p_first_name: form.first, p_last_name: form.last,
        p_email: form.email, p_phone: form.phone || null, p_complete: true,
      });
      if (error) throw error;
      finish();
    } catch (e: any) {
      setFormError(
        /INVALID_EMAIL/.test(e?.message) ? 'That email doesn’t look right.'
        : /INVALID_PHONE/.test(e?.message) ? 'That phone number doesn’t look right.'
        : 'Couldn’t save that — please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    try { await supabase.rpc('skip_onboarding'); } catch { /* never block on this */ }
    finish();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Welcome to Gnome</Text>
          <Pressable onPress={skip} hitSlop={10} accessibilityRole="button">
            <Text style={styles.skip}>Skip for now</Text>
          </Pressable>
        </View>

        {aiAvailable ? (
          <>
            <ScrollView
              ref={scroller}
              style={styles.flex}
              contentContainerStyle={styles.thread}
              onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
            >
              {messages.map((m, i) => (
                <View
                  key={i}
                  style={[styles.bubble, m.role === 'user' ? styles.mine : styles.theirs]}
                >
                  <Text style={m.role === 'user' ? styles.mineText : styles.theirsText}>{m.content}</Text>
                </View>
              ))}
              {busy && (
                <View style={[styles.bubble, styles.theirs]}>
                  <ActivityIndicator color={Colors.textSecondary} />
                </View>
              )}
              {state?.completed && (
                <Text style={styles.done}>All set — taking you in…</Text>
              )}
            </ScrollView>

            {!state?.completed && (
              <View style={styles.composer}>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Type your answer…"
                  placeholderTextColor={Colors.textSecondary}
                  editable={!busy}
                  onSubmitEditing={onSend}
                  returnKeyType="send"
                />
                <Button label="Send" onPress={onSend} disabled={busy || !input.trim()} />
              </View>
            )}
          </>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.form}>
            <Text style={styles.formIntro}>
              Just a few details so neighbors know who they’re trading with. Only your
              first name and last initial are shown publicly — your email and phone stay private.
            </Text>
            <FormField label="First name" value={form.first} onChange={(v) => setForm({ ...form, first: v })} />
            <FormField label="Last name" value={form.last} onChange={(v) => setForm({ ...form, last: v })} />
            <FormField label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })}
              keyboardType="email-address" autoCapitalize="none" />
            <FormField label="Mobile (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })}
              keyboardType="phone-pad" />
            {formError && <Text style={styles.error}>{formError}</Text>}
            <Button label={busy ? 'Saving…' : 'Save and continue'} onPress={saveForm} disabled={busy} />
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function FormField(props: {
  label: string; value: string; onChange: (v: string) => void;
  keyboardType?: 'default' | 'email-address' | 'phone-pad'; autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={props.value}
        onChangeText={props.onChange}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'words'}
        placeholderTextColor={Colors.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontFamily: fonts.bold, fontSize: 22, color: Colors.text },
  skip: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.textSecondary },
  thread: { paddingVertical: 12, gap: 10 },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.surface },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  theirsText: { fontFamily: fonts.regular, fontSize: 15, color: Colors.text, lineHeight: 21 },
  mineText: { fontFamily: fonts.regular, fontSize: 15, color: '#fff', lineHeight: 21 },
  done: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 12 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  input: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontFamily: fonts.regular, fontSize: 15, color: Colors.text,
  },
  form: { paddingVertical: 12, gap: 14 },
  formIntro: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  field: { gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: Colors.text },
  fieldInput: {
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: fonts.regular, fontSize: 15, color: Colors.text,
  },
  error: { fontFamily: fonts.regular, fontSize: 13, color: Colors.error },
});
