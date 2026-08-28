'use client';

// The gnome in the corner — Gnome's site-wide AI assistant.
// Launcher is always present (small, calm, never auto-opens); the panel
// mounts on first open. All model calls go through the gnome-assistant edge
// function (JWT-gated, multimodal, per-day caps, server-held API key). Logged-out
// visitors get the sign-in card inside the panel. The MODEL stays
// read-only; management requests ("change Roma Tomatoes to $5/quart")
// are routed server-side to owner-scoped RPCs, and renewal-class or bulk
// work comes back as a proposal that executes only when the seller
// clicks Confirm here (ai_confirm_action under their own JWT).
import { usePathname } from 'next/navigation';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from './auth';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  imagePreview?: string | null;
  /** Server-bound market-management payloads riding on an assistant reply. A proposal
   * executes ONLY when the seller clicks Confirm — that click calls ai_confirm_action
   * with their own JWT; the model cannot make that call. */
  proposal?: Proposal | null;
  options?: DisambigOption[] | null;
  paymentAsk?: PaymentAsk | null;
  sourceText?: string;
}

interface Proposal {
  action_id: string;
  action: 'renew' | 'restock' | 'mark_sold_bulk' | 'set_price_bulk' | 'create_drop' | 'create_bundle';
  summary: string;
  count: number;
  expires_in_minutes: number;
  items: { id: string; title: string }[];
  payment?: { required: boolean; already_paid: boolean; price_cents: number };
}
interface DisambigOption { id: string; title: string; detail: string }

interface ChatAttachment {
  name: string;
  preview: string;
  base64: string;
  mediaType: 'image/jpeg';
}
interface ZordyUsage {
  plan: string;
  plan_display: string;
  daily_limit: number;
  used: number;
  remaining: number;
  resets_on: string;
}

const MAX_WEB_CHAT_IMAGE_B64 = 8_000_000;

function friendlyAssistantError(error: unknown, body?: { error?: unknown; message?: unknown }) {
  const code = typeof body?.error === 'string' ? body.error : '';
  const message = typeof body?.message === 'string' ? body.message : '';
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/JWT|auth|sign.?in|unauth|401|403/i.test(`${code} ${message} ${raw}`)) {
    return 'Sign in to use Zordy.';
  }
  if (code === 'IMAGE_TOO_LARGE' || /image.*too large/i.test(message)) {
    return 'That photo is too large. Try a smaller image.';
  }
  if (code === 'DAILY_LIMIT') {
    return message || 'You’ve used today’s Zordy requests. They reset tomorrow.';
  }
  if (code === 'AI_BUSY' || /network|fetch|timeout|503|busy/i.test(`${code} ${message} ${raw}`)) {
    return 'Zordy is busy. Try again in a moment.';
  }
  return 'Zordy couldn’t answer just now. Try again in a moment.';
}

async function fileToChatImage(file: File): Promise<ChatAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a photo file.');
  }
  const bitmap = await createImageBitmap(file);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare that photo.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const preview = canvas.toDataURL('image/jpeg', 0.84);
  const base64 = preview.split(',')[1] ?? '';
  if (base64.length > MAX_WEB_CHAT_IMAGE_B64) {
    throw new Error('That photo is too large. Try a smaller image.');
  }
  return { name: file.name || 'photo.jpg', preview, base64, mediaType: 'image/jpeg' };
}

/** A confirm came back payment_needed: these exact listings' renewals want $0.99.
 * The card reuses the EXISTING overage checkout (billing-checkout → Stripe-hosted
 * page in a new tab → webhook → my_overage_required polling); once the authorization
 * lands, the renewal executes through a fresh server-bound proposal + confirm that
 * consumes the payment bound to this exact listing. Server truth decides everything —
 * a closed tab or duplicate return can never double-charge or double-renew. */
interface PaymentAsk {
  items: { id: string; title: string }[];
  verb: 'Renew' | 'Restock';
}

const ACTIONS: { match: (p: string) => boolean; chips: string[] }[] = [
  {
    match: (p) => p.startsWith('/browse') || p.startsWith('/near') || p.startsWith('/category'),
    chips: ['Explain Trade listings', 'Why do cards say Preview?', 'How does distance work?', 'Help me find tomatoes'],
  },
  {
    match: (p) => p.startsWith('/garden'),
    chips: ['What can I plant right now?', 'Why are my tomato leaves yellow?', 'Which Grow tool should I use?'],
  },
  {
    match: (p) => p.startsWith('/seeds'),
    chips: ['How does personalization work?', 'Where is my Seed Drop?', 'What can I plant this month?', 'Which seeds work for containers?'],
  },
  {
    match: (p) => p.startsWith('/plots'),
    chips: ['How do plot reservations work?', 'What happens if a crop fails?', 'How do I offer a plot?'],
  },
  {
    match: (p) => p.startsWith('/pricing'),
    chips: ['Which plan fits me?', 'How many Zordy requests do I get?', 'Does Gnome take a percentage?', 'What does Pro include?'],
  },
  {
    match: (p) => p.startsWith('/my') || p.startsWith('/sell'),
    chips: ['Mark my cucumbers sold out', 'Change Roma Tomatoes to $5/quart', 'How many of my listings are expiring?', 'Which imported drafts still need prices?'],
  },
  {
    match: () => true,
    chips: ["What's wrong with my plant?", 'Help me create a listing', "What's happening in my Market?", 'Help me promote my Market', 'How do I use Gnome?'],
  },
];

export default function GnomeAssistant() {
  const pathname = usePathname() ?? '/';
  const { session, ready } = useSession();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [usage, setUsage] = useState<ZordyUsage | null>(null);
  // paidFlow[listingId]: 'paying' | 'waiting' | 'processing' | 'done'
  const [paidFlow, setPaidFlow] = useState<Record<string, string>>({});
  // action_id -> settled, so a proposal's buttons disappear once it is decided.
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chips = ACTIONS.find((a) => a.match(pathname))!.chips;

  useEffect(() => {
    if (!session) { setUsage(null); return; }
    void supabaseBrowser().rpc('my_zordy_usage').then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setUsage(row as ZordyUsage);
    });
  }, [session]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === '#gnome-ai') setOpen(true);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, busy]);

  // The admin console keeps its corner clear; everywhere else the gnome waits.
  if (pathname.startsWith('/admin')) return null;

  async function send(text: string, image = attachment) {
    const q = text.trim();
    if ((!q && !image) || busy) return;
    if (!ready) {
      setNote('One moment — Zordy is checking your session.');
      return;
    }
    if (ready && !session) {
      setNote('Sign in to use Zordy');
      return;
    }
    setNote(null);
    const next: Turn[] = [...turns, {
      role: 'user',
      content: q || 'Photo attached',
      imagePreview: image?.preview ?? null,
    }];
    setTurns(next);
    setInput('');
    if (image) setAttachment(null);
    setBusy(true);
    logWeb('gnome_message', { has_image: !!image });
    try {
      const serverMessages = next.map(({ role, content }, i) => ({
        role,
        content: image && i === next.length - 1 ? q : content,
      }));
      const { data, error } = await supabaseBrowser().functions.invoke('gnome-assistant', {
        body: {
          action: 'chat',
          messages: serverMessages,
          page: pathname,
          platform: 'web',
          ...(image ? { image: { image_base64: image.base64, media_type: image.mediaType } } : {}),
        },
      });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(friendlyAssistantError(error, body ?? undefined));
      }
      const reply = typeof data?.reply === 'string' ? data.reply : null;
      if (!reply) throw new Error(friendlyAssistantError(null, data));
      if (data?.usage) setUsage(data.usage as ZordyUsage);
      setTurns([...next, {
        role: 'assistant', content: reply,
        proposal: data.proposal ?? null,
        options: data.disambiguation?.options ?? null,
        sourceText: q,
      }]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Zordy couldn’t answer just now. Try again in a moment.');
      if (image) setAttachment(image);
      setTurns(next); // keep the user's message; they can retry
    } finally {
      setBusy(false);
    }
  }

  async function onPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file || busy) return;
    setNote(null);
    try {
      setAttachment(await fileToChatImage(file));
      logWeb('gnome_photo_attached');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That photo could not be prepared.');
    }
  }

  async function confirmProposal(p: Proposal) {
    if (busy || settled[p.action_id]) return;
    setBusy(true);
    logWeb('gnome_action_confirmed', { action: p.action, count: p.count });
    try {
      const { data, error } = await supabaseBrowser().rpc('ai_confirm_action', { p_action_id: p.action_id });
      if (error) throw new Error(String(error.message ?? ''));
      if (p.action === 'create_bundle') {
        setSettled((s) => ({ ...s, [p.action_id]: true }));
        const bpay = Number(data?.payment_needed ?? 0);
        if (bpay > 0) {
          setTurns((t2) => [...t2, {
            role: 'assistant',
            content: 'Your plan’s Sell publishes are used up, so publishing this basket needs a $0.99 extra publish (or an upgrade). Nothing was created — you can build it from My Market → Gift Baskets when you’re ready.',
          }]);
          return;
        }
        const bt = String(data?.bundle?.title ?? 'Gift Basket');
        const bn = Number(data?.bundle?.items ?? 0);
        setTurns((t2) => [...t2, {
          role: 'assistant',
          content: `Done — “${bt}” is live with ${bn} item${bn === 1 ? '' : 's'} inside. It runs like any Sell listing and buyers can see exactly what’s in it.`,
        }]);
        return;
      }
      if (p.action === 'create_drop') {
        const t = String(data?.drop?.title ?? 'Market Drop');
        const n = Number(data?.drop?.items ?? 0);
        setSettled((s) => ({ ...s, [p.action_id]: true }));
        setTurns((t2) => [...t2, {
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
      if (pay) parts.push(`${pay} need${pay === 1 ? 's' : ''} a $0.99 renewal — your plan's included renewals are used up.`);
      if (!parts.length) parts.push('Nothing needed doing — everything was already in that state.');
      setSettled((s) => ({ ...s, [p.action_id]: true }));
      // Per-listing server results say exactly which renewals want $0.99 — those become the
      // payment card wired into the existing overage checkout, not a dead end.
      const results: { ok?: boolean; error?: string; id?: string }[] = Array.isArray(data?.results) ? data.results : [];
      const needPay = results
        .filter((r) => r?.ok === false && r?.error === 'PAYMENT_REQUIRED')
        .map((r) => ({ id: String(r.id ?? ''), title: p.items.find((it) => it.id === r.id)?.title ?? 'this listing' }))
        .filter((it) => it.id);
      setTurns((t) => [...t, {
        role: 'assistant',
        content: parts.join(' '),
        paymentAsk: needPay.length ? { items: needPay, verb: p.action === 'restock' ? 'Restock' : 'Renew' } : null,
      }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setNote(/ACTION_EXPIRED/.test(msg)
        ? 'That confirmation expired — ask again and I’ll set it up fresh.'
        : /ACTION_ALREADY/.test(msg)
          ? 'That one’s already been handled.'
          : 'That confirmation didn’t go through — nothing was changed. Try asking again.');
      if (/ACTION_EXPIRED|ACTION_ALREADY/.test(msg)) setSettled((s) => ({ ...s, [p.action_id]: true }));
    } finally {
      setBusy(false);
    }
  }

  // ---- the $0.99 leg: existing overage checkout in a new tab, poll for the webhook,
  // then execute the EXACT paid renewal via a fresh server-bound proposal + confirm.

  async function finishPaidRenewal(item: { id: string; title: string }) {
    const sb = supabaseBrowser();
    try {
      const { data: prop, error: pe } = await sb.rpc('ai_propose_action', {
        p_action: 'renew', p_listing_ids: [item.id], p_payload: {},
        p_summary: `Renew "${item.title}" using your $0.99 payment`, p_request: null,
      });
      if (pe) throw new Error(String(pe.message ?? ''));
      const { data: res, error: ce } = await sb.rpc('ai_confirm_action', { p_action_id: prop.action_id });
      if (ce) throw new Error(String(ce.message ?? ''));
      if (Number(res?.ok_count ?? 0) >= 1) {
        setPaidFlow((s) => ({ ...s, [item.id]: 'done' }));
        setTurns((t) => [...t, {
          role: 'assistant',
          content: `Done — “${item.title}” is renewed and live for another 7 days. Your $0.99 payment covered exactly this renewal.`,
        }]);
        logWeb('gnome_ai_paid_renewal_completed');
      } else {
        // Not executed. Say what is actually true: paid-but-webhook-pending reads differently
        // from never-paid. my_overage_required is the server truth for both.
        const { data: ov } = await sb.rpc('my_overage_required', { p_listing: item.id });
        const row = Array.isArray(ov) ? ov[0] : ov;
        setPaidFlow((s) => ({ ...s, [item.id]: 'processing' }));
        setTurns((t) => [...t, {
          role: 'assistant',
          content: row?.required === false
            ? 'Stripe is still confirming your payment. Click “Finish renewal” again in a few seconds — you will not be charged twice.'
            : 'I don’t see a completed payment yet. If you just paid, give it a few seconds and click “Finish renewal” again — you will never be charged twice. If you cancelled checkout, nothing was charged.',
        }]);
      }
    } catch {
      setPaidFlow((s) => ({ ...s, [item.id]: 'processing' }));
      setNote('Couldn’t finish the renewal just now — your payment is safe. Click “Finish renewal” to try again.');
    }
  }

  async function payAndRenew(item: { id: string; title: string }) {
    const state = paidFlow[item.id];
    if (state === 'paying' || state === 'waiting' || state === 'done') return;
    setNote(null);
    setPaidFlow((s) => ({ ...s, [item.id]: 'paying' }));
    logWeb('gnome_ai_checkout_started');
    const sb = supabaseBrowser();
    try {
      const { data, error } = await sb.functions.invoke('billing-checkout', {
        body: { product_key: 'GNOME_LISTING_RENEWAL', listing_id: item.id, platform: 'web' },
      });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        if (body?.error === 'NO_PAYMENT_REQUIRED') {
          // Already authorized (or allowance freed up) — just finish.
          await finishPaidRenewal(item);
          return;
        }
        throw new Error(String(body?.error ?? 'CHECKOUT_FAILED'));
      }
      if (!data?.url) throw new Error('NO_URL');
      window.open(data.url, '_blank', 'noopener');
      setPaidFlow((s) => ({ ...s, [item.id]: 'waiting' }));
      // Poll for the webhook-confirmed authorization. Server truth only: a closed tab or a
      // return without payment simply never flips ALREADY_AUTHORIZED, and nothing executes.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data: ov } = await sb.rpc('my_overage_required', { p_listing: item.id });
        const row = Array.isArray(ov) ? ov[0] : ov;
        if (row && row.required === false && row.reason === 'ALREADY_AUTHORIZED') {
          await finishPaidRenewal(item);
          return;
        }
        if (row && row.required === false) { await finishPaidRenewal(item); return; }
      }
      setPaidFlow((s) => ({ ...s, [item.id]: 'processing' }));
      setTurns((t) => [...t, {
        role: 'assistant',
        content: 'I haven’t seen the payment come through yet. If you finished checkout, click “Finish renewal” — you will not be charged twice. If you closed the checkout tab, nothing was charged.',
      }]);
    } catch {
      setPaidFlow((s) => { const { [item.id]: _gone, ...rest } = s; return rest; });
      setNote('The checkout could not start. Nothing was charged.');
    }
  }

  async function cancelProposal(p: Proposal) {
    if (settled[p.action_id]) return;
    setSettled((s) => ({ ...s, [p.action_id]: true }));
    logWeb('gnome_action_cancelled', { action: p.action });
    try { await supabaseBrowser().rpc('ai_cancel_action', { p_action_id: p.action_id }); } catch { /* it expires on its own */ }
    setTurns((t) => [...t, { role: 'assistant', content: 'Cancelled — nothing was changed.' }]);
  }

  return (
    <>
      <button
        className="gnome-launcher"
        aria-label={open ? 'Close Zordy' : 'Ask Zordy — your garden and Market assistant'}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) logWeb('gnome_opened', { page: pathname });
        }}
      >
        <span className="gnome-ai-mark" aria-hidden>
          <span className="zordy-portrait" />
          <span className="gnome-ai-spark">✦</span>
        </span>
      </button>

      {open && (
        <div className="gnome-panel" role="dialog" aria-label="Zordy assistant chat">
          <div className="gp-head">
            <span className="gp-avatar" aria-hidden>
              <span className="zordy-portrait" />
              <span>✦</span>
            </span>
            <div>
              <strong>Zordy</strong>
              <span className="gp-sub">Your garden &amp; Market assistant</span>
              {usage && (
                <span className="gp-sub gp-usage">
                  {usage.remaining} of {usage.daily_limit} Zordy requests left today
                </span>
              )}
            </div>
            <button className="gp-close" aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="gp-log" ref={logRef}>
            {turns.length === 0 && (
              <div className="bubble assistant">
                Hey, I’m Zordy. What are we working on? I can help with growing,
                plant photos, listings, your Market, promotion, plans — or just how this place works.
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i}>
                <div className={`bubble ${t.role === 'user' ? 'user' : 'assistant'}`}>
                  {t.imagePreview && <img className="bubble-photo" src={t.imagePreview} alt="Uploaded preview" />}
                  {t.content}
                </div>
                {!!t.options?.length && (
                  <div className="gp-chips" style={{ marginTop: 6 }}>
                    {t.options.map((o) => (
                      <button
                        key={o.id}
                        className="chip"
                        disabled={busy}
                        onClick={() => void send(`${t.sourceText ?? ''} — the one called "${o.title}"`)}
                      >
                        {o.detail}
                      </button>
                    ))}
                  </div>
                )}
                {!!t.proposal && !settled[t.proposal.action_id] && (
                  <div className="gp-proposal" style={{
                    margin: '6px 0 0', padding: '10px 12px', borderRadius: 12,
                    border: '1px solid var(--ai-purple, #6B2FB9)', display: 'grid', gap: 6,
                  }}>
                    <strong style={{ fontSize: 14 }}>{t.proposal.summary}</strong>
                    {t.proposal.count > 1 && (
                      <span style={{ fontSize: 13, opacity: 0.75 }}>
                        {t.proposal.items.slice(0, 6).map((it) => it.title).join(' · ')}
                        {t.proposal.count > 6 ? ` +${t.proposal.count - 6} more` : ''}
                      </span>
                    )}
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button className="btn btn-primary btn-sm" disabled={busy}
                        onClick={() => void confirmProposal(t.proposal!)}>Confirm</button>
                      <button className="chip" disabled={busy}
                        onClick={() => void cancelProposal(t.proposal!)}>Cancel</button>
                    </span>
                  </div>
                )}
                {!!t.paymentAsk && t.paymentAsk.items.map((item) => (
                  paidFlow[item.id] === 'done' ? null : (
                    <div key={item.id} className="gp-proposal" style={{
                      margin: '6px 0 0', padding: '10px 12px', borderRadius: 12,
                      border: '1px solid var(--ai-purple, #6B2FB9)', display: 'grid', gap: 6,
                    }}>
                      <strong style={{ fontSize: 14 }}>{t.paymentAsk!.verb} {item.title}</strong>
                      <span style={{ fontSize: 13, opacity: 0.75 }}>Another 7 days · $0.99 one time</span>
                      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {paidFlow[item.id] === 'processing' ? (
                          <button className="btn btn-primary btn-sm"
                            onClick={() => void finishPaidRenewal(item)}>Finish renewal</button>
                        ) : (
                          <button className="btn btn-primary btn-sm"
                            disabled={paidFlow[item.id] === 'paying' || paidFlow[item.id] === 'waiting'}
                            onClick={() => void payAndRenew(item)}>
                            {paidFlow[item.id] === 'paying' ? 'Opening checkout…'
                              : paidFlow[item.id] === 'waiting' ? 'Waiting for checkout…'
                              : `${t.paymentAsk!.verb} for $0.99`}
                          </button>
                        )}
                        <button className="chip"
                          onClick={() => setPaidFlow((s) => ({ ...s, [item.id]: 'done' }))}>Not now</button>
                      </span>
                    </div>
                  )
                ))}
              </div>
            ))}
            {busy && <div className="bubble assistant thinking">Checking the garden gates…</div>}
            {note && <p className="autherror" style={{ margin: '4px 0 0' }}>{note}</p>}
          </div>

          {ready && !session ? (
            <div className="gp-auth">
              <SignInCard
                title="Sign in to use Zordy"
                blurb="Create an account or sign in to ask Zordy questions, analyze photos, and manage your Market."
              />
            </div>
          ) : null}
          {turns.length === 0 && (
            <div className="gp-chips">
              {chips.map((c) => (
                <button
                  key={c}
                  className="chip"
                  onClick={() => { logWeb('gnome_quick_action', { chip: c }); void send(c); }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="gp-composer">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhotoChange} />
            <button
              type="button"
              className="gp-photo-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              aria-label="Upload a photo for Zordy"
            >
              + Photo
            </button>
            <input
              value={input}
              placeholder={attachment ? 'Ask Zordy about this photo...' : 'Ask Zordy anything...'}
              maxLength={1500}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(input); }}
            />
            <button className="btn btn-primary btn-sm" disabled={busy || (!input.trim() && !attachment)} onClick={() => void send(input)}>
              Send
            </button>
          </div>
          {attachment && (
            <div className="gp-attachment">
              <img src={attachment.preview} alt="Selected photo preview" />
              <span>{attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)}>Remove</button>
            </div>
          )}
          <p className="gp-fine">
            Gnome can answer questions and, when you ask plainly, update your own
            listings — bigger changes always wait for your Confirm. It never touches
            billing. Garden advice depends on your real conditions.
          </p>
        </div>
      )}
    </>
  );
}
