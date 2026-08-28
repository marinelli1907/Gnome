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
  ActionSheetIOS, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ImagePlus, Send, Sparkles, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { fetchListingScreening } from '@/lib/db';
import { pickImages, takePhoto, uploadListingImages } from '@/lib/images';
import { parseServerError, type ServerError } from '@/lib/taxonomy';
import { alertScreeningError, alertUnderReview, isUnderReview, safeErrorText } from '@/lib/screening';
import { purchaseOverage } from '@/lib/billing';
import { canBuyDigitalInApp } from '@/lib/digitalPurchase';

/**
 * Server-bound action payloads riding on an assistant reply (market management).
 * A proposal executes ONLY when the seller taps Confirm here — that tap calls
 * ai_confirm_action with their own JWT; the model cannot make that call.
 */
type Proposal = {
  action_id: string;
  action: 'renew' | 'restock' | 'mark_sold_bulk' | 'set_price_bulk' | 'create_drop' | 'create_bundle';
  summary: string;
  count: number;
  expires_in_minutes: number;
  items: { id: string; title: string }[];
  payment?: { required: boolean; already_paid: boolean; price_cents: number };
};
type DisambigOption = { id: string; title: string; detail: string };

/** A confirm came back payment_needed: the exact listings whose renewal wants $0.99.
 * The card this renders reuses the EXISTING overage checkout (purchaseOverage →
 * Stripe-hosted TEST/LIVE checkout → webhook → my_overage_required reconciliation);
 * after the authorization lands, the renewal executes through a fresh server-bound
 * proposal + confirm, which consumes the payment bound to this exact listing. */
type PaymentAsk = {
  items: { id: string; title: string }[];
  verb: 'Renew' | 'Restock';
};

type Msg = {
  role: 'user' | 'assistant'; content: string;
  imageUri?: string | null;
  proposal?: Proposal | null;
  options?: DisambigOption[] | null;
  paymentAsk?: PaymentAsk | null;
  /** the user message that produced this reply — reused when a disambiguation chip is tapped */
  sourceText?: string;
};

type ChatAttachment = {
  uri: string;
  base64: string;
  mediaType: 'image/jpeg';
};
type ZordyUsage = {
  plan: string;
  plan_display: string;
  daily_limit: number;
  used: number;
  remaining: number;
  resets_on: string;
};
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

const STARTERS: { prompt: string; hint: string }[] = [
  { prompt: "What's wrong with my plant?", hint: '' },
  { prompt: 'Help me create a listing', hint: '' },
  { prompt: "What's happening in my Market?", hint: '' },
  { prompt: 'What should I sell right now?', hint: '' },
  { prompt: 'Help me promote my Market', hint: '' },
  { prompt: 'How do I use Gnome?', hint: '' },
];

const AI_AUTH_TITLE = 'Sign in to use Zordy';
const AI_AUTH_MESSAGE = 'Create an account or sign in to ask Zordy questions, analyze photos, and manage your Market.';
const AI_RETRY_MESSAGE = 'Zordy couldn’t answer right now. Please try again in a moment.';

function isAiAuthFailure(err: unknown) {
  const e = err as { message?: unknown; name?: unknown; code?: unknown; status?: unknown; context?: { status?: unknown; error?: unknown } };
  const status = Number(e?.status ?? e?.context?.status ?? 0);
  const text = [
    e?.message,
    e?.name,
    e?.code,
    e?.context?.error,
  ].map((v) => String(v ?? '')).join(' ');
  return status === 401 || /UNAUTHENTICATED|JWT|auth|sign in/i.test(text);
}

function compactAllowance(u: ZordyUsage | null | undefined) {
  if (!u) return null;
  return `${u.remaining} of ${u.daily_limit} Zordy request${u.daily_limit === 1 ? '' : 's'} left today`;
}

function limitCta(u: ZordyUsage | null | undefined) {
  if (!u || u.plan === 'free') return 'Upgrade to Pro';
  return u.plan === 'grower' ? 'See Farm' : null;
}

function cleanAssistantReply(raw: unknown): string {
  const text = String(raw ?? '')
    .replace(/^NO\s+MARKDOWN(?:\/ASTERISKS)?\s*:?\s*/i, '')
    .replace(/^NO\s+ASTERISKS\s*:?\s*/i, '')
    .replace(/^STYLE\s*:?\s*/i, '')
    .replace(/^PLAIN\s+TEXT\s+ONLY\s*:?\s*/i, '')
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, '$1')
    .replace(/\*([^*\n][^*]*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || AI_RETRY_MESSAGE;
}

async function functionErrorBody(err: unknown): Promise<{ error?: string; message?: string; usage?: ZordyUsage } | null> {
  try {
    const res = (err as { context?: Response })?.context;
    return res?.json ? await res.json() : null;
  } catch {
    return null;
  }
}

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
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [limitReached, setLimitReached] = useState<{ message: string; usage?: ZordyUsage | null } | null>(null);
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

  const zordyUsage = useQuery({
    queryKey: ['zordy-usage', userId],
    enabled: isSupabaseConfigured && !!userId,
    queryFn: async (): Promise<ZordyUsage | null> => {
      const { data, error: e } = await supabase.rpc('my_zordy_usage');
      if (e) throw e;
      return (Array.isArray(data) ? data[0] : data) as ZordyUsage | null;
    },
  });

  const attachAsset = useCallback((asset: ImagePickerAsset | null) => {
    if (!asset) return;
    if (!asset.base64) {
      setError('That photo did not come through cleanly. Try another image.');
      return;
    }
    setAttachment({ uri: asset.uri, base64: asset.base64, mediaType: 'image/jpeg' });
  }, []);

  const chooseAttachment = useCallback(async (source: 'camera' | 'library') => {
    setError(null);
    try {
      if (source === 'camera') {
        attachAsset(await takePhoto());
      } else {
        const [asset] = await pickImages({ selectionLimit: 1 });
        attachAsset(asset ?? null);
      }
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      setError(
        /CAMERA_RESTRICTED/.test(msg)
          ? 'Camera access is restricted on this device.'
          : /CAMERA_DENIED/.test(msg)
            ? 'Camera permission is needed to take a photo. You can still choose one from your library.'
            : 'Couldn’t open photos right now. Try again in a moment.',
      );
    }
  }, [attachAsset]);

  const showAttachmentMenu = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['TAKE PHOTO', 'CHOOSE FROM LIBRARY', 'CANCEL'],
          cancelButtonIndex: 2,
        },
        (index) => {
          if (index === 0) void chooseAttachment('camera');
          if (index === 1) void chooseAttachment('library');
        },
      );
      return;
    }
    Alert.alert('Add photo', undefined, [
      { text: 'TAKE PHOTO', onPress: () => void chooseAttachment('camera') },
      { text: 'CHOOSE FROM LIBRARY', onPress: () => void chooseAttachment('library') },
      { text: 'CANCEL', style: 'cancel' },
    ]);
  }, [chooseAttachment]);

  const requireAiSignIn = useCallback(() => {
    setError(null);
    setShowAuthGate(true);
  }, []);

  const openSignIn = useCallback(() => {
    router.push('/sign-in');
  }, [router]);

  const ask = useCallback(async (text: string, image: ChatAttachment | null = null) => {
    const clean = text.trim();
    if ((!clean && !image) || busy) return;
    if (!userId) {
      requireAiSignIn();
      return;
    }
    setError(null);
    setLimitReached(null);
    setShowAuthGate(false);
    const displayText = clean || 'Photo attached';
    const next: Msg[] = [...messages, {
      role: 'user',
      content: displayText,
      imageUri: image?.uri ?? null,
    }];
    setMessages(next);
    setInput('');
    if (image) setAttachment(null);
    setBusy(true);
    try {
      const serverMessages = next.map(({ role, content }) => ({ role, content }));
      if (image) serverMessages[serverMessages.length - 1] = { role: 'user', content: clean };
      const { data, error: e } = await supabase.functions.invoke('gnome-assistant', {
        body: {
          action: 'chat',
          messages: serverMessages,
          platform: Platform.OS,
          ...(image ? {
            image: { image_base64: image.base64, media_type: image.mediaType },
          } : {}),
        },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.message ?? data.error);
      if (data?.usage) void qc.setQueryData(['zordy-usage', userId], data.usage);
      setMessages((m) => [...m, {
        role: 'assistant',
        content: cleanAssistantReply(data.reply),
        proposal: data.proposal ?? null,
        options: data.disambiguation?.options ?? null,
        sourceText: clean,
      }]);
      // A management action may have changed listings the rest of the app shows.
      if (data.action_result?.ok) {
        void qc.invalidateQueries({ queryKey: ['listings'] });
        void qc.invalidateQueries({ queryKey: ['listing-drafts', userId] });
      }
    } catch (err: any) {
      if (isAiAuthFailure(err)) {
        requireAiSignIn();
      } else {
        const body = await functionErrorBody(err);
        if (body?.error === 'DAILY_LIMIT') {
          setLimitReached({ message: body.message ?? 'You’ve used today’s Zordy requests.', usage: body.usage ?? null });
          if (body.usage) void qc.setQueryData(['zordy-usage', userId], body.usage);
        } else {
          setError(body?.message && !/ASSISTANT_FAILED|EDGE/i.test(body.message) ? body.message : AI_RETRY_MESSAGE);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [busy, messages, qc, requireAiSignIn, userId]);

  // action_id -> settled, so a card's buttons disappear once it is decided.
  const [settled, setSettled] = useState<Record<string, boolean>>({});

  const confirmProposal = useCallback(async (p: Proposal) => {
    if (busy || settled[p.action_id]) return;
    setBusy(true);
    try {
      const { data, error: e } = await supabase.rpc('ai_confirm_action', { p_action_id: p.action_id });
      if (e) throw e;
      if (p.action === 'create_bundle') {
        setSettled((s) => ({ ...s, [p.action_id]: true }));
        const pay = Number(data?.payment_needed ?? 0);
        if (pay > 0) {
          setMessages((m) => [...m, {
            role: 'assistant',
            content: canBuyDigitalInApp
              ? 'Your plan’s Sell publishes are used up, so publishing this basket needs a $0.99 extra publish (or an upgrade). Nothing was created — you can publish it from My Market when you’re ready.'
              : 'Your plan’s Sell publishes are used up for this period. Nothing was created — upgrade for unlimited Sell publishes, or publish the basket when your allowance resets.',
          }]);
          return;
        }
        const bt = String(data?.bundle?.title ?? 'Gift Basket');
        const bn = Number(data?.bundle?.items ?? 0);
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `Done — “${bt}” is live with ${bn} item${bn === 1 ? '' : 's'} inside. It runs like any Sell listing and buyers can see exactly what’s in it.`,
        }]);
        return;
      }
      if (p.action === 'create_drop') {
        const t = String(data?.drop?.title ?? 'Market Drop');
        const n = Number(data?.drop?.items ?? 0);
        setSettled((s) => ({ ...s, [p.action_id]: true }));
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `Done — “${t}” is scheduled with ${n} item${n === 1 ? '' : 's'}. It goes live automatically at the start time and appears on your public Market.`,
        }]);
        return;
      }
      const ok = Number(data?.ok_count ?? 0);
      const pay = Number(data?.payment_needed ?? 0);
      const did = p.action === 'mark_sold_bulk' ? 'marked sold'
        : p.action === 'set_price_bulk' ? 'updated'
        : p.action === 'restock' ? 'restocked' : 'renewed';
      const parts: string[] = [];
      if (ok) parts.push(`${ok} listing${ok === 1 ? '' : 's'} ${did}.`);
      if (pay) {
        parts.push(canBuyDigitalInApp
          ? `${pay} need${pay === 1 ? 's' : ''} a $0.99 renewal — your plan's included renewals are used up.`
          : `${pay} need${pay === 1 ? 's' : ''} renewal help — your plan's included renewals are used up.`);
      }
      if (!parts.length) parts.push('Nothing needed doing — everything was already in that state.');
      setSettled((s) => ({ ...s, [p.action_id]: true }));
      // The server's per-listing results say exactly which renewals want $0.99; those become
      // a payment card wired into the existing overage checkout — never a dead end.
      const needPay = (Array.isArray(data?.results) ? data.results : [])
        .filter((r: { ok?: boolean; error?: string }) => r?.ok === false && r?.error === 'PAYMENT_REQUIRED')
        .map((r: { id?: string }) => ({
          id: String(r.id ?? ''),
          title: p.items.find((it) => it.id === r.id)?.title ?? 'this listing',
        }))
        .filter((it: { id: string }) => it.id);
      setMessages((m) => [...m, {
        role: 'assistant',
        content: parts.join(' '),
        paymentAsk: needPay.length
          ? { items: needPay, verb: p.action === 'restock' ? 'Restock' : 'Renew' }
          : null,
      }]);
      void qc.invalidateQueries({ queryKey: ['listings'] });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      setError(/ACTION_EXPIRED/.test(msg)
        ? 'That confirmation expired — ask me again and I\'ll set it up fresh.'
        : /ACTION_ALREADY/.test(msg)
          ? 'That one\'s already been handled.'
          : 'That confirmation didn\'t go through — nothing was changed. Try asking again.');
      if (/ACTION_EXPIRED|ACTION_ALREADY/.test(msg)) setSettled((s) => ({ ...s, [p.action_id]: true }));
    } finally {
      setBusy(false);
    }
  }, [busy, settled, qc]);

  // ---- the $0.99 leg: existing overage checkout, then execute the EXACT paid renewal -------
  // paidFlow[listingId]: 'paying' | 'processing' | 'done' — drives the card's buttons.
  const [paidFlow, setPaidFlow] = useState<Record<string, string>>({});

  /** Execute the renewal AFTER the authorization exists: a fresh server-bound proposal +
   * confirm. The 0104 gate consumes the payment bound to this listing; nothing here can
   * renew anything else or renew twice (server truth). */
  const finishPaidRenewal = useCallback(async (item: { id: string; title: string }) => {
    try {
      const { data: prop, error: pe } = await supabase.rpc('ai_propose_action', {
        p_action: 'renew', p_listing_ids: [item.id], p_payload: {},
        p_summary: `Renew "${item.title}" using your $0.99 payment`, p_request: null,
      });
      if (pe) throw pe;
      const { data: res, error: ce } = await supabase.rpc('ai_confirm_action', {
        p_action_id: prop.action_id,
      });
      if (ce) throw ce;
      if (Number(res?.ok_count ?? 0) >= 1) {
        setPaidFlow((s) => ({ ...s, [item.id]: 'done' }));
        setMessages((m) => [...m, {
          role: 'assistant',
          content: `Done — “${item.title}” is renewed and live for another 7 days. Your $0.99 payment covered exactly this renewal.`,
        }]);
        void qc.invalidateQueries({ queryKey: ['listings'] });
      } else {
        // Not executed. Say what is actually true: paid-but-webhook-pending reads differently
        // from never-paid. my_overage_required is the server truth for both.
        const { data: ov } = await supabase.rpc('my_overage_required', { p_listing: item.id });
        const row = Array.isArray(ov) ? ov[0] : ov;
        setPaidFlow((s) => ({ ...s, [item.id]: 'processing' }));
        setMessages((m) => [...m, {
          role: 'assistant',
          content: row?.required === false
            ? 'Stripe is still confirming your payment. Tap “Finish renewal” again in a few seconds — you will not be charged twice.'
            : 'I don’t see a completed payment yet. If you just paid, give it a few seconds and tap “Finish renewal” again — you will never be charged twice. If you cancelled checkout, nothing was charged.',
        }]);
      }
    } catch {
      setPaidFlow((s) => ({ ...s, [item.id]: 'processing' }));
      setError('Couldn\'t finish the renewal just now — your payment is safe. Tap “Finish renewal” to try again.');
    }
  }, [qc]);

  const payAndRenew = useCallback(async (item: { id: string; title: string }) => {
    if (paidFlow[item.id] === 'paying' || paidFlow[item.id] === 'done') return;
    if (!canBuyDigitalInApp) {
      router.push('/upgrade');
      return;
    }
    setError(null);
    setPaidFlow((s) => ({ ...s, [item.id]: 'paying' }));
    const outcome = await purchaseOverage(item.id);
    if (outcome === 'paid' || outcome === 'not_needed') {
      await finishPaidRenewal(item);
    } else if (outcome === 'pending') {
      setPaidFlow((s) => ({ ...s, [item.id]: 'processing' }));
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Payment received — Stripe is confirming. Tap “Finish renewal” in a few seconds; you will not be charged twice.',
      }]);
    } else if (outcome === 'cancelled') {
      setPaidFlow((s) => { const { [item.id]: _gone, ...rest } = s; return rest; });
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Checkout cancelled — nothing was charged and nothing changed. The button is still here if you change your mind.',
      }]);
    } else {
      setPaidFlow((s) => { const { [item.id]: _gone, ...rest } = s; return rest; });
      setError('The checkout could not start. Nothing was charged.');
    }
  }, [paidFlow, finishPaidRenewal, router]);

  const cancelProposal = useCallback(async (p: Proposal) => {
    if (settled[p.action_id]) return;
    setSettled((s) => ({ ...s, [p.action_id]: true }));
    try { await supabase.rpc('ai_cancel_action', { p_action_id: p.action_id }); } catch { /* it expires on its own */ }
    setMessages((m) => [...m, { role: 'assistant', content: 'Cancelled — nothing was changed.' }]);
  }, [settled]);

  // Photos → one draft per photo. Uploaded first so the draft carries a real
  // image, then analyzed in memory server-side.
  const addPhotos = useCallback(async () => {
    setError(null);
    setLimitReached(null);
    if (!userId) {
      requireAiSignIn();
      return;
    }
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
      if (data?.usage) void qc.setQueryData(['zordy-usage', userId], data.usage);

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
      const body = await functionErrorBody(err);
      setRetryCount(0);
      if (body?.error === 'DAILY_LIMIT') {
        setLimitReached({ message: body.message ?? 'You’ve used today’s Zordy requests.', usage: body.usage ?? null });
        if (body.usage) void qc.setQueryData(['zordy-usage', userId], body.usage);
        return;
      }
      setError(
        /PLAN_REQUIRED/.test(msg) ? 'Drafting listings from photos is included with paid plans.'
        : /NO_MARKET/.test(msg) ? 'Post once from the Post tab to create your Market first.'
        : /DAILY_LIMIT/.test(msg) ? 'You’ve used today’s Zordy requests — they reset tomorrow.'
        : 'Couldn’t analyze those photos — try again in a moment.',
      );
    } finally {
      setAnalyzing(0);
    }
  }, [qc, requireAiSignIn, userId]);

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
    if (r.error?.code === 'PUBLISH_ALLOWANCE_EXHAUSTED') {
      // Draft rows persist server-side, so the retry after purchase is just publishing again.
      // D1: no in-app digital purchase on Android until Play Billing (v1.2).
      // The draft persists server-side either way.
      Alert.alert(
        'Included listings used up',
        canBuyDigitalInApp
          ? 'You’ve used your included Sell listings for this period. The draft stays saved.'
          : 'You’ve used your included Sell listings for this period. The draft stays saved — upgrade for unlimited Sell listings.',
        [
          { text: 'Not now', style: 'cancel' },
          ...(!canBuyDigitalInApp
            ? [{ text: 'See plans', onPress: () => router.push('/upgrade') }]
            : []),
          ...(!canBuyDigitalInApp ? [] : [{ text: 'Publish for $0.99', onPress: async () => {
            const outcome = await purchaseOverage(null);
            if (outcome === 'paid' || outcome === 'not_needed') void publish(d);
            else if (outcome === 'pending') Alert.alert('Payment received', 'Stripe is confirming. Tap publish again in a few seconds — you will not be charged twice.');
            else if (outcome === 'error') Alert.alert('Something went wrong', 'The checkout could not start. Nothing was charged.');
          } }]),
        ],
      );
      return;
    }
    if (r.error?.code === 'ACCOUNT_NOT_READY') {
      Alert.alert(r.error.title, r.error.message, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Finish setup', onPress: () => router.push('/account-ready' as never) },
      ]);
      return;
    }
    Alert.alert(
      r.error?.code === 'PLAN_LIMIT_REACHED' ? 'Listing limit reached' : 'Couldn’t publish',
      r.error?.code === 'PLAN_LIMIT_REACHED'
        ? 'You’re at your plan’s listing limit right now. Upgrade for more room — the draft stays saved.'
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
          <Image source={require('../../assets/images/zordy-avatar.png')} style={styles.aiAvatar} />
          <View style={styles.aiTitleRow}>
            <Sparkles size={18} color={Colors.aiPurple} />
            <View style={styles.titleStack}>
              <Text style={styles.title}>Zordy</Text>
              <Text style={styles.subtitle}>Your garden &amp; Market assistant</Text>
            </View>
          </View>
          {!!userId && compactAllowance(zordyUsage.data) && (
            <Text style={styles.allowance}>{compactAllowance(zordyUsage.data)}</Text>
          )}
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
              <Text style={styles.introLead}>Your garden and Market assistant.</Text>
              <Text style={styles.introText}>
                Ask about plants, snap a photo, create listings, manage your Market,
                promote what you sell, or get help using Gnome.
              </Text>
              <Text style={styles.quickActions}>Quick actions:</Text>
              {STARTERS.map((s) => (
                <Pressable key={s.prompt} style={styles.starter} onPress={() => ask(s.prompt)}>
                  <Text style={styles.starterText}>{s.prompt}</Text>
                  {!!s.hint && <Text style={styles.starterHint}>{s.hint}</Text>}
                </Pressable>
              ))}
            </View>
          )}

          {messages.map((m, i) => (
            <View key={i} style={m.role === 'user' ? styles.mineWrap : styles.theirsWrap}>
              <View style={[styles.bubble, m.role === 'user' ? styles.mine : styles.theirs]}>
                {!!m.imageUri && (
                  <Image source={{ uri: m.imageUri }} style={styles.messagePhoto} />
                )}
                <Text style={m.role === 'user' ? styles.mineText : styles.theirsText}>{m.content}</Text>
              </View>
              {!!m.options?.length && (
                <View style={styles.optionsWrap}>
                  {m.options.map((o) => (
                    <Pressable
                      key={o.id}
                      style={styles.starter}
                      disabled={busy}
                      onPress={() => ask(`${m.sourceText ?? ''} — the one called "${o.title}"`)}
                    >
                      <Text style={styles.starterText}>{o.detail}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {!!m.proposal && !settled[m.proposal.action_id] && (
                <View style={styles.proposalCard}>
                  <Text style={styles.proposalTitle}>{m.proposal.summary}</Text>
                  {m.proposal.count > 1 && (
                    <Text style={styles.proposalMeta}>
                      {m.proposal.items.slice(0, 6).map((it) => it.title).join(' · ')}
                      {m.proposal.count > 6 ? ` +${m.proposal.count - 6} more` : ''}
                    </Text>
                  )}
                  <View style={styles.cardActions}>
                    <Button label="Confirm" onPress={() => void confirmProposal(m.proposal!)} />
                    <Pressable onPress={() => void cancelProposal(m.proposal!)} hitSlop={6}>
                      <Text style={styles.linkMuted}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {!!m.paymentAsk && m.paymentAsk.items.map((item) => (
                paidFlow[item.id] === 'done' ? null : (
                  <View key={item.id} style={styles.proposalCard}>
                    <Text style={styles.proposalTitle}>{m.paymentAsk!.verb} {item.title}</Text>
                    <Text style={styles.proposalMeta}>
                      {canBuyDigitalInApp
                        ? 'Another 7 days · $0.99 one time'
                        : 'Included renewals used up — Pro renews without limits'}
                    </Text>
                    <View style={styles.cardActions}>
                      {/* D1: Android cannot sell this in-app until Play Billing
                          (v1.2), so the card offers the plan instead of a price. */}
                      {!canBuyDigitalInApp ? (
                        <Button label="See plans" onPress={() => router.push('/upgrade')} />
                      ) : paidFlow[item.id] === 'processing' ? (
                        <Button label="Finish renewal" onPress={() => void finishPaidRenewal(item)} />
                      ) : (
                        <Button
                          label={paidFlow[item.id] === 'paying' ? 'Opening checkout…' : `${m.paymentAsk!.verb} for $0.99`}
                          onPress={() => void payAndRenew(item)}
                        />
                      )}
                      <Pressable
                        onPress={() => setPaidFlow((s) => ({ ...s, [item.id]: 'done' }))}
                        hitSlop={6}
                      >
                        <Text style={styles.linkMuted}>Not now</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              ))}
            </View>
          ))}

          {(busy || analyzing > 0) && (
            <View style={[styles.bubble, styles.theirs, styles.row]}>
              <ActivityIndicator color={Colors.textSecondary} />
              {analyzing > 0 && (
                <Text style={styles.thinking}>
                  Zordy is looking at {analyzing} photo{analyzing === 1 ? '' : 's'}…
                </Text>
              )}
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          {limitReached && (
            <View style={styles.limitCard}>
              <Text style={styles.authGateTitle}>{limitReached.message}</Text>
              {limitCta(limitReached.usage ?? zordyUsage.data) && (
                <Button
                  label={limitCta(limitReached.usage ?? zordyUsage.data)!}
                  onPress={() => router.push('/upgrade')}
                  style={styles.authGateButton}
                />
              )}
            </View>
          )}

          {showAuthGate && !userId && (
            <View style={styles.authGate}>
              <Text style={styles.authGateTitle}>{AI_AUTH_TITLE}</Text>
              <Text style={styles.authGateText}>{AI_AUTH_MESSAGE}</Text>
              <Button label="Sign in / Sign up" onPress={openSignIn} style={styles.authGateButton} />
            </View>
          )}

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
          {!!attachment && (
            <View style={styles.attachmentPreview}>
              <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
              <View style={styles.attachmentActions}>
                <Pressable
                  onPress={showAttachmentMenu}
                  hitSlop={8}
                  style={styles.attachmentIcon}
                  accessibilityLabel="Replace attached photo"
                >
                  <Camera size={17} color={Colors.aiPurple} />
                </Pressable>
                <Pressable
                  onPress={() => setAttachment(null)}
                  hitSlop={8}
                  style={styles.attachmentIcon}
                  accessibilityLabel="Remove attached photo"
                >
                  <X size={17} color={Colors.error} />
                </Pressable>
              </View>
            </View>
          )}
          <Pressable
            onPress={showAttachmentMenu}
            disabled={analyzing > 0}
            style={styles.photoBtn}
            accessibilityLabel="Attach a photo"
          >
            <ImagePlus size={22} color={analyzing > 0 ? Colors.textTertiary : Colors.aiPurple} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Zordy..."
            placeholderTextColor={Colors.textTertiary}
            editable={!busy}
            onSubmitEditing={() => ask(input, attachment)}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={() => ask(input, attachment)}
            disabled={busy || (!input.trim() && !attachment)}
            style={[styles.sendBtn, (busy || (!input.trim() && !attachment)) && styles.sendBtnOff]}
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
  header: { gap: 8, paddingBottom: 10 },
  aiAvatar: {
    width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: Colors.aiPurple,
    backgroundColor: Colors.surface,
  },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleStack: { gap: 1 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: Colors.text },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  allowance: { fontFamily: fonts.semibold, fontSize: 12, color: Colors.aiPurple },
  thread: { paddingVertical: 10, gap: 10 },
  intro: { gap: 10, paddingBottom: 6 },
  introLead: { fontFamily: fonts.semibold, fontSize: 17, color: Colors.text, lineHeight: 23 },
  introText: {
    fontFamily: fonts.regular, fontSize: 15, color: Colors.textSecondary,
    lineHeight: 21, marginBottom: 6,
  },
  starter: {
    backgroundColor: Colors.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  starterText: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.text },
  quickActions: { fontFamily: fonts.semibold, fontSize: 13, color: Colors.aiPurple },
  starterHint: {
    fontFamily: fonts.regular, fontSize: 12, color: Colors.textSecondary,
    lineHeight: 16, marginTop: 2,
  },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  mineWrap: { alignSelf: 'flex-end', maxWidth: '88%' },
  theirsWrap: { alignSelf: 'flex-start', maxWidth: '88%', gap: 8 },
  optionsWrap: { gap: 6 },
  proposalCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 12, gap: 6,
    borderWidth: 1, borderColor: Colors.aiPurple,
  },
  proposalTitle: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.text, lineHeight: 20 },
  proposalMeta: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The assistant's bubble is the AI's own voice: the neutral chat surface
  // with an AI Purple hairline, so purple owns the room without two purple
  // fills that would stop telling the speakers apart. Charcoal #222222 on
  // #F1F5F9 measures 14.5:1.
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.chatBubbleAI,
    borderWidth: 1,
    borderColor: Colors.aiPurple,
  },
  // White on AI Purple #6B2FB9 measures 7.69:1.
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.chatBubbleUser },
  theirsText: { fontFamily: fonts.regular, fontSize: 15, color: Colors.chatBubbleAIText, lineHeight: 22 },
  mineText: { fontFamily: fonts.regular, fontSize: 15, color: Colors.chatBubbleUserText, lineHeight: 22 },
  messagePhoto: {
    width: 180, height: 132, borderRadius: 10, marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  thinking: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary },
  error: { fontFamily: fonts.regular, fontSize: 14, color: Colors.error, paddingHorizontal: 4 },
  authGate: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: Colors.aiPurple,
  },
  limitCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: Colors.aiPurple,
  },
  authGateTitle: { fontFamily: fonts.semibold, fontSize: 15, color: Colors.text },
  authGateText: { fontFamily: fonts.regular, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  authGateButton: { alignSelf: 'flex-start', marginTop: 8 },
  retry: {
    alignSelf: 'flex-start', backgroundColor: Colors.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: Colors.aiPurple,
  },
  // AI Purple on white: 7.69:1.
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.aiPurple },

  draftsWrap: { gap: 10, marginTop: 6 },
  draftsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  draftsTitle: { fontFamily: fonts.semibold, fontSize: 15, color: Colors.text },
  publishAll: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.aiPurple },
  publishAllBusy: { color: Colors.textTertiary },
  card: {
    flexDirection: 'row', gap: 10, backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden',
  },
  cardPhoto: { width: 92, height: '100%', minHeight: 120, backgroundColor: Colors.backgroundSecondary },
  cardEditing: { borderColor: Colors.aiPurple },
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
  link: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.aiPurple },
  linkMuted: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.textTertiary },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 6 },
  attachmentPreview: {
    width: 64, height: 64, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.aiPurple, backgroundColor: Colors.backgroundSecondary,
  },
  attachmentImage: { width: '100%', height: '100%' },
  attachmentActions: {
    position: 'absolute', top: 4, right: 4, gap: 4,
  },
  attachmentIcon: {
    width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight,
  },
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
    // White glyph on AI Purple #6B2FB9: 7.69:1 (icons need 3:1).
    backgroundColor: Colors.aiPurple,
  },
  sendBtnOff: { opacity: 0.4 },
});
