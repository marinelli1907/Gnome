// Gnome AI — the assistant tab.
//
// Chat about growing, what's happening in your market, what to sell and why,
// and how to use the app. Add photos and Gnome drafts a listing per photo —
// several photos in one go become several separate drafts.
//
// Nothing is published automatically. Drafts appear as review cards: Publish,
// Edit (in place — the draft row stays the single source of truth), or Discard.
// Publishing goes through publish_listing_draft, which inserts a normal listing
// and therefore runs the same plan-limit and validation triggers as a
// hand-written post. "Publish all" deliberately skips anything flagged as
// commonly regulated, so eggs/dairy/meat/canned goods always get a human look.
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Send, Sparkles } from 'lucide-react-native';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { fetchListingScreening } from '@/lib/db';
import { pickImages, uploadListingImages } from '@/lib/images';
import { parseServerError, type ServerError } from '@/lib/taxonomy';
import { alertScreeningError, alertUnderReview, isUnderReview, safeErrorText } from '@/lib/screening';

type Msg = { role: 'user' | 'assistant'; content: string };
type Draft = {
  id: string; title: string | null; description: string | null;
  category: string | null; listing_type: string; price_cents: number | null;
  unit: string | null; quantity: string | null; photos: string[];
  ai_confidence: number | null; ai_seller_questions: string[];
  compliance_attention: boolean; status: string;
};
/**
 * What the server actually did with one draft. Publishing goes through a
 * trigger that can save-and-hold or refuse outright, so "the RPC returned" is
 * not the same as "it is live" — the caller has to be told which.
 */
type PublishResult =
  | { outcome: 'published' }
  | { outcome: 'review'; reason: string | null }
  | { outcome: 'blocked'; error: ServerError }
  | { outcome: 'ratelimited'; error: ServerError }
  | { outcome: 'failed'; error: ServerError | null; message: string };

const STARTERS = [
  'What should I sell right now, and why?',
  'What’s happening in my market?',
  'When do I plant garlic here?',
  'How do I get more requests on my listings?',
];

export default function AiTab() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const { userId } = useAuth();
  const scroller = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // A bulk publish is a sequence of real writes; a second tap mid-run would
  // publish the same drafts twice.
  const [bulkBusy, setBulkBusy] = useState(false);

  const drafts = useQuery({
    queryKey: ['listing-drafts', userId],
    enabled: isSupabaseConfigured && !!userId,
    queryFn: async (): Promise<Draft[]> => {
      const { data, error: e } = await supabase
        .from('listing_drafts')
        .select('id,title,description,category,listing_type,price_cents,unit,quantity,photos,ai_confidence,ai_seller_questions,compliance_attention,status')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (e) throw e;
      return (data ?? []) as Draft[];
    },
  });

  const ask = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setError(null);
    const next: Msg[] = [...messages, { role: 'user', content: text.trim() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const { data, error: e } = await supabase.functions.invoke('gnome-assistant', {
        body: { action: 'chat', messages: next },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.message ?? data.error);
      setMessages((m) => [...m, { role: 'assistant', content: String(data.reply ?? '') }]);
    } catch (err: any) {
      setError(err?.message ?? 'The gnome tripped over a root — try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, messages]);

  // Photos → one draft per photo. Uploaded first so the draft carries a real
  // image, then analyzed in memory server-side.
  const addPhotos = useCallback(async () => {
    setError(null);
    try {
      const assets = await pickImages({ selectionLimit: 10 });
      if (!assets.length) return;
      setAnalyzing(assets.length);

      const urls = await uploadListingImages(userId!, assets);
      const images = await Promise.all(assets.map(async (a, i) => {
        // Re-encode: strips EXIF/GPS and bounds the payload.
        const small = await ImageManipulator.manipulateAsync(
          a.uri, [{ resize: { width: 1024 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        return { image_base64: small.base64, media_type: 'image/jpeg', photo_url: urls[i] ?? null };
      }));

      const { data, error: e } = await supabase.functions.invoke('gnome-assistant', {
        body: { action: 'draft_from_photos', images },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.message ?? data.error);

      const made = (data.drafts ?? []).length;
      const skipped = (data.skipped ?? []).length;
      await qc.invalidateQueries({ queryKey: ['listing-drafts', userId] });
      // A skipped photo is never turned into a half-guessed listing, so say so
      // plainly and leave an obvious way to try it again.
      setRetryCount(skipped);
      setMessages((m) => [...m, {
        role: 'assistant',
        content: made
          ? `I drafted ${made} listing${made === 1 ? '' : 's'} from your photo${assets.length === 1 ? '' : 's'}.` +
            (skipped ? ` ${skipped} photo${skipped === 1 ? '' : 's'} didn't come through cleanly — I left ${skipped === 1 ? 'it' : 'them'} out rather than guess.` : '') +
            ' Review them below, then publish the ones you want.'
          : 'I couldn’t read those photos cleanly, so I didn’t draft anything rather than guess. A closer, brighter shot of a single item usually does it.',
      }]);
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      setRetryCount(0);
      setError(
        /PLAN_REQUIRED/.test(msg) ? 'Drafting listings from photos is a Grower & Farm feature.'
        : /NO_MARKET/.test(msg) ? 'Post once from the Post tab to create your Market first.'
        : /DAILY_LIMIT/.test(msg) ? 'You’ve hit today’s AI limit — it resets tomorrow.'
        : 'Couldn’t analyze those photos — try again in a moment.',
      );
    } finally {
      setAnalyzing(0);
    }
  }, [qc, userId]);

  // Publishes one draft and reports what came back. It deliberately shows
  // nothing itself: one draft and twenty drafts owe the seller the same facts
  // told very differently, and stacking an alert per draft is what we're fixing.
  const publishDraft = async (d: Draft): Promise<PublishResult> => {
    try {
      const { data, error: e } = await supabase.rpc('publish_listing_draft', { p_draft: d.id });
      if (e) throw e;
      await qc.invalidateQueries({ queryKey: ['listing-drafts', userId] });
      await qc.invalidateQueries({ queryKey: ['listings'] });
      // The RPC hands back only the new listing's id, and the screening trigger
      // can park that row as `paused` on the way in — so ask the row itself
      // whether this draft actually reached buyers.
      const saved = data ? await fetchListingScreening(String(data)) : null;
      if (isUnderReview(saved)) {
        return { outcome: 'review', reason: saved?.screening_reason ?? null };
      }
      return { outcome: 'published' };
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      const parsed = parseServerError(msg);
      if (parsed?.code === 'PROHIBITED_ITEM' || parsed?.code === 'PROHIBITED_CATEGORY') {
        return { outcome: 'blocked', error: parsed };
      }
      if (parsed?.code === 'RATE_LIMITED') return { outcome: 'ratelimited', error: parsed };
      return { outcome: 'failed', error: parsed, message: msg };
    }
  };

  const publish = async (d: Draft) => {
    const r = await publishDraft(d);
    // Published cleanly: the draft card disappearing is the confirmation.
    if (r.outcome === 'published') return;
    if (r.outcome === 'review') {
      alertUnderReview({ screening_reason: r.reason });
      return;
    }
    if (r.outcome === 'blocked' || r.outcome === 'ratelimited') {
      alertScreeningError(r.error);
      return;
    }
    Alert.alert(
      r.error?.code === 'PLAN_LIMIT_REACHED' ? 'Listing limit reached' : 'Couldn’t publish',
      r.error?.code === 'PLAN_LIMIT_REACHED'
        ? 'You’re at your plan’s active listing limit. Upgrade or pause a listing, then publish this one.'
        : safeErrorText(r.message, 'Something went wrong publishing that draft.'),
    );
  };

  // Edits are written straight to the draft row (owner-only RLS), so the draft
  // stays the single source of truth right up to the moment it's published.
  const saveEdit = async () => {
    if (!editing) return;
    const patch = {
      title: (editing.title ?? '').trim(),
      description: editing.description,
      unit: editing.unit,
      quantity: editing.quantity,
      price_cents: editing.price_cents,
    };
    if (!patch.title) { Alert.alert('Title needed', 'Give this listing a title before saving.'); return; }
    try {
      const { error: e } = await supabase.from('listing_drafts').update(patch).eq('id', editing.id);
      if (e) throw e;
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['listing-drafts', userId] });
    } catch {
      Alert.alert('Couldn’t save', 'That edit didn’t stick — try again.');
    }
  };

  const discard = async (d: Draft) => {
    try {
      await supabase.rpc('discard_listing_draft', { p_draft: d.id });
      await qc.invalidateQueries({ queryKey: ['listing-drafts', userId] });
    } catch { /* the list refetch will show reality */ }
  };

  // One pass, one summary. Each publish is a real listing against the seller's
  // plan limit and can come back held or refused, so this asks first and then
  // reports the whole batch once instead of an alert per draft.
  const runPublishAll = async (list: Draft[]) => {
    setBulkBusy(true);
    let published = 0;
    let held = 0;
    let blocked = 0;
    let failed = 0;
    let stopped: ServerError | null = null;
    // Verbatim server copy, kept apart by outcome and deduplicated: twelve held
    // eggs share one sentence, and a held listing is not a refused one.
    const heldReasons = new Set<string>();
    const blockedReasons = new Set<string>();
    try {
      for (const d of list) {
        const r = await publishDraft(d);
        if (r.outcome === 'published') published += 1;
        else if (r.outcome === 'review') {
          held += 1;
          if (r.reason?.trim()) heldReasons.add(r.reason.trim());
        } else if (r.outcome === 'blocked') {
          blocked += 1;
          blockedReasons.add(r.error.message);
        } else if (r.outcome === 'ratelimited') {
          // Pace, not content: every remaining draft would hit the same wall,
          // so stop and leave them pending rather than burn through them.
          stopped = r.error;
          break;
        } else failed += 1;
      }
    } finally {
      setBulkBusy(false);
    }

    const lines = [`${published} published.`];
    if (held) lines.push(`${held} held for review.`);
    if (blocked) lines.push(`${blocked} not allowed on Gnome.`);
    if (failed) lines.push(`${failed} didn’t go through — try ${failed === 1 ? 'it' : 'them'} again.`);
    if (stopped) lines.push(`Stopped early. ${stopped.message}`);
    const parts = [lines.join('\n')];
    if (heldReasons.size) parts.push(`Held for review:\n${Array.from(heldReasons).slice(0, 2).join('\n\n')}`);
    if (blockedReasons.size) parts.push(`Not allowed:\n${Array.from(blockedReasons).slice(0, 2).join('\n\n')}`);
    Alert.alert(
      `Published ${published} of ${list.length}`,
      parts.join('\n\n'),
      held
        ? [
            { text: 'Seller verification', onPress: () => router.push('/compliance') },
            { text: 'OK', style: 'cancel' },
          ]
        : undefined,
    );
  };

  const publishAll = () => {
    const list = (drafts.data ?? []).filter((d) => !d.compliance_attention);
    if (!list.length || bulkBusy) return;
    Alert.alert(
      `Publish ${list.length} drafts?`,
      'They go live as ordinary listings right away. Anything flagged as commonly regulated is left out — publish those one at a time.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: `Publish ${list.length}`, onPress: () => void runPublishAll(list) },
      ],
    );
  };

  const pending = drafts.data ?? [];
  const bulkable = pending.filter((d) => !d.compliance_attention).length;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.bottom + 56}
    >
      <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
        <View style={styles.header}>
          <Sparkles size={18} color={Colors.primary} />
          <Text style={styles.title}>Gnome AI</Text>
        </View>

        <ScrollView
          ref={scroller}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.intro}>
              <Text style={styles.introText}>
                Ask me about growing, what’s selling near you, or what to list next.
                Add photos and I’ll draft a listing for each one — you approve them.
              </Text>
              {STARTERS.map((s) => (
                <Pressable key={s} style={styles.starter} onPress={() => ask(s)}>
                  <Text style={styles.starterText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {messages.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'user' ? styles.mine : styles.theirs]}>
              <Text style={m.role === 'user' ? styles.mineText : styles.theirsText}>{m.content}</Text>
            </View>
          ))}

          {(busy || analyzing > 0) && (
            <View style={[styles.bubble, styles.theirs, styles.row]}>
              <ActivityIndicator color={Colors.textSecondary} />
              {analyzing > 0 && (
                <Text style={styles.thinking}>
                  Looking at {analyzing} photo{analyzing === 1 ? '' : 's'}…
                </Text>
              )}
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          {retryCount > 0 && (
            <Pressable style={styles.retry} onPress={() => { setRetryCount(0); void addPhotos(); }}>
              <Text style={styles.retryText}>
                Try {retryCount === 1 ? 'that photo' : `those ${retryCount} photos`} again
              </Text>
            </Pressable>
          )}

          {pending.length > 0 && (
            <View style={styles.draftsWrap}>
              <View style={styles.draftsHead}>
                <Text style={styles.draftsTitle}>
                  {pending.length} draft{pending.length === 1 ? '' : 's'} to review
                </Text>
                {bulkable > 1 && (
                  <Pressable onPress={publishAll} hitSlop={8} disabled={bulkBusy}>
                    <Text style={[styles.publishAll, bulkBusy && styles.publishAllBusy]}>
                      {bulkBusy ? 'Publishing…' : `Publish all ${bulkable}`}
                    </Text>
                  </Pressable>
                )}
              </View>
              {pending.map((d) => (
                editing?.id === d.id ? (
                  <DraftEditor
                    key={d.id}
                    draft={editing}
                    onChange={setEditing}
                    onCancel={() => setEditing(null)}
                    onSave={saveEdit}
                  />
                ) : (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    onPublish={() => publish(d)}
                    onDiscard={() => discard(d)}
                    onEdit={() => setEditing({ ...d })}
                  />
                )
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: 8 }]}>
          <Pressable
            onPress={addPhotos}
            disabled={analyzing > 0}
            style={styles.photoBtn}
            accessibilityLabel="Add photos to draft listings"
          >
            <ImagePlus size={22} color={analyzing > 0 ? Colors.textTertiary : Colors.primary} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Gnome anything…"
            placeholderTextColor={Colors.textTertiary}
            editable={!busy}
            onSubmitEditing={() => ask(input)}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={() => ask(input)}
            disabled={busy || !input.trim()}
            style={[styles.sendBtn, (busy || !input.trim()) && styles.sendBtnOff]}
            accessibilityLabel="Send"
          >
            <Send size={18} color={Colors.textOnPrimary} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function DraftCard(props: {
  draft: Draft; onPublish: () => void; onDiscard: () => void; onEdit: () => void;
}) {
  const { draft: d } = props;
  const price = d.price_cents != null ? `$${(d.price_cents / 100).toFixed(2)}` : null;
  return (
    <View style={styles.card}>
      {!!d.photos?.[0] && <Image source={{ uri: d.photos[0] }} style={styles.cardPhoto} />}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{d.title}</Text>
        <Text style={styles.cardMeta}>
          {[price && `${price}${d.unit ? ` / ${d.unit}` : ''}`, d.quantity, d.category]
            .filter(Boolean).join(' · ')}
        </Text>
        {!!d.description && (
          <Text style={styles.cardDesc} numberOfLines={3}>{d.description}</Text>
        )}
        {d.compliance_attention && (
          <Text style={styles.flag}>
            Often regulated (eggs, dairy, meat, canned goods) — check your state’s rules before publishing.
          </Text>
        )}
        {d.ai_confidence != null && d.ai_confidence < 0.6 && (
          <Text style={styles.lowConf}>I’m not fully sure what this is — worth a quick edit.</Text>
        )}
        <View style={styles.cardActions}>
          <Button label="Publish" onPress={props.onPublish} />
          <Pressable onPress={props.onEdit} hitSlop={6}><Text style={styles.link}>Edit</Text></Pressable>
          <Pressable onPress={props.onDiscard} hitSlop={6}><Text style={styles.linkMuted}>Discard</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

function DraftEditor(props: {
  draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void;
}) {
  const { draft: d, onChange } = props;
  const dollars = d.price_cents != null ? (d.price_cents / 100).toFixed(2) : '';
  return (
    <View style={[styles.card, styles.cardEditing]}>
      <View style={styles.cardBody}>
        <Text style={styles.editLabel}>Title</Text>
        <TextInput
          style={styles.editInput}
          value={d.title ?? ''}
          onChangeText={(v) => onChange({ ...d, title: v })}
          placeholderTextColor={Colors.textTertiary}
        />
        <Text style={styles.editLabel}>Description</Text>
        <TextInput
          style={[styles.editInput, styles.editArea]}
          value={d.description ?? ''}
          onChangeText={(v) => onChange({ ...d, description: v })}
          multiline
          placeholderTextColor={Colors.textTertiary}
        />
        <View style={styles.editRow}>
          <View style={styles.editCol}>
            <Text style={styles.editLabel}>Price ($)</Text>
            <TextInput
              style={styles.editInput}
              value={dollars}
              keyboardType="decimal-pad"
              onChangeText={(v) => {
                const n = Number(v.replace(/[^0-9.]/g, ''));
                onChange({ ...d, price_cents: Number.isFinite(n) ? Math.round(n * 100) : null });
              }}
              placeholderTextColor={Colors.textTertiary}
            />
          </View>
          <View style={styles.editCol}>
            <Text style={styles.editLabel}>Unit</Text>
            <TextInput
              style={styles.editInput}
              value={d.unit ?? ''}
              onChangeText={(v) => onChange({ ...d, unit: v })}
              placeholder="lb, each, bunch"
              placeholderTextColor={Colors.textTertiary}
            />
          </View>
        </View>
        <Text style={styles.editLabel}>Quantity</Text>
        <TextInput
          style={styles.editInput}
          value={d.quantity ?? ''}
          onChangeText={(v) => onChange({ ...d, quantity: v })}
          placeholder="about 8 tomatoes"
          placeholderTextColor={Colors.textTertiary}
        />
        <View style={styles.cardActions}>
          <Button label="Save" onPress={props.onSave} />
          <Pressable onPress={props.onCancel} hitSlop={6}>
            <Text style={styles.linkMuted}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: Colors.text },
  thread: { paddingVertical: 10, gap: 10 },
  intro: { gap: 8, paddingBottom: 6 },
  introText: { fontFamily: fonts.regular, fontSize: 15, color: Colors.textSecondary, lineHeight: 21 },
  starter: {
    backgroundColor: Colors.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  starterText: { fontFamily: fonts.regular, fontSize: 14, color: Colors.text },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.surface },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  theirsText: { fontFamily: fonts.regular, fontSize: 15, color: Colors.text, lineHeight: 22 },
  mineText: { fontFamily: fonts.regular, fontSize: 15, color: Colors.textOnPrimary, lineHeight: 22 },
  thinking: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary },
  error: { fontFamily: fonts.regular, fontSize: 14, color: Colors.error, paddingHorizontal: 4 },
  retry: {
    alignSelf: 'flex-start', backgroundColor: Colors.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: Colors.primary,
  },
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.primary },

  draftsWrap: { gap: 10, marginTop: 6 },
  draftsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  draftsTitle: { fontFamily: fonts.semibold, fontSize: 15, color: Colors.text },
  publishAll: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.primary },
  publishAllBusy: { color: Colors.textTertiary },
  card: {
    flexDirection: 'row', gap: 10, backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden',
  },
  cardPhoto: { width: 92, height: '100%', minHeight: 120, backgroundColor: Colors.backgroundSecondary },
  cardEditing: { borderColor: Colors.primary },
  cardBody: { flex: 1, padding: 12, gap: 4 },
  editLabel: { fontFamily: fonts.semibold, fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  editInput: {
    backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: fonts.regular, fontSize: 14, color: Colors.text,
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  editArea: { minHeight: 68, textAlignVertical: 'top' },
  editRow: { flexDirection: 'row', gap: 10 },
  editCol: { flex: 1 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: Colors.text },
  cardMeta: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  cardDesc: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  flag: { fontFamily: fonts.regular, fontSize: 12, color: Colors.warning, marginTop: 2 },
  lowConf: { fontFamily: fonts.regular, fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.primary },
  linkMuted: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.textTertiary },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 6 },
  photoBtn: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight,
  },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: Colors.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: Platform.OS === 'ios' ? 11 : 8,
    paddingBottom: Platform.OS === 'ios' ? 11 : 8,
    fontFamily: fonts.regular, fontSize: 15, color: Colors.text,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  sendBtnOff: { opacity: 0.4 },
});
