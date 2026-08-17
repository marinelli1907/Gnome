'use client';

// The gnome in the corner — Gnome's site-wide AI assistant.
// Launcher is always present (small, calm, never auto-opens); the panel
// mounts on first open. All model calls go through the ask-gnome edge
// function (JWT-gated, per-day caps, server-held API key). Logged-out
// visitors get the sign-in card inside the panel. The MODEL stays
// read-only; management requests ("change Roma Tomatoes to $5/quart")
// are routed server-side to owner-scoped RPCs, and renewal-class or bulk
// work comes back as a proposal that executes only when the seller
// clicks Confirm here (ai_confirm_action under their own JWT).
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { GnomeMascot } from './art';
import { SignInCard, useSession } from './auth';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Server-bound market-management payloads riding on an assistant reply. A proposal
   * executes ONLY when the seller clicks Confirm — that click calls ai_confirm_action
   * with their own JWT; the model cannot make that call. */
  proposal?: Proposal | null;
  options?: DisambigOption[] | null;
  sourceText?: string;
}

interface Proposal {
  action_id: string;
  action: 'renew' | 'restock' | 'mark_sold_bulk' | 'set_price_bulk';
  summary: string;
  count: number;
  expires_in_minutes: number;
  items: { id: string; title: string }[];
}
interface DisambigOption { id: string; title: string; detail: string }

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
    chips: ['Which plan fits me?', 'Does Gnome take a percentage?', 'What does Pro include?'],
  },
  {
    match: (p) => p.startsWith('/my') || p.startsWith('/sell'),
    chips: ['Help me write a listing', 'What should I charge?', 'Why isn’t my listing showing?'],
  },
  {
    match: () => true,
    chips: ['What is Gnome?', 'Find local food', 'Help me start growing', 'How do I sell here?'],
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
  // action_id -> settled, so a proposal's buttons disappear once it is decided.
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const chips = ACTIONS.find((a) => a.match(pathname))!.chips;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, busy]);

  // The admin console keeps its corner clear; everywhere else the gnome waits.
  if (pathname.startsWith('/admin')) return null;

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setNote(null);
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    setBusy(true);
    logWeb('gnome_message');
    try {
      const { data, error } = await supabaseBrowser().functions.invoke('ask-gnome', {
        body: { messages: next, page: pathname },
      });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'The gnome tripped over a root — try again in a moment.');
      }
      const reply = typeof data?.reply === 'string' ? data.reply : null;
      if (!reply) throw new Error(data?.error ?? 'The gnome tripped over a root — try again in a moment.');
      setTurns([...next, {
        role: 'assistant', content: reply,
        proposal: data.proposal ?? null,
        options: data.disambiguation?.options ?? null,
        sourceText: q,
      }]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Something went sideways — try again shortly.');
      setTurns(next); // keep the user's message; they can retry
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal(p: Proposal) {
    if (busy || settled[p.action_id]) return;
    setBusy(true);
    logWeb('gnome_action_confirmed', { action: p.action, count: p.count });
    try {
      const { data, error } = await supabaseBrowser().rpc('ai_confirm_action', { p_action_id: p.action_id });
      if (error) throw new Error(String(error.message ?? ''));
      const ok = Number(data?.ok_count ?? 0);
      const pay = Number(data?.payment_needed ?? 0);
      const did = p.action === 'mark_sold_bulk' ? 'marked sold'
        : p.action === 'set_price_bulk' ? 'updated'
        : p.action === 'restock' ? 'restocked' : 'renewed';
      const parts: string[] = [];
      if (ok) parts.push(`${ok} listing${ok === 1 ? '' : 's'} ${did}.`);
      if (pay) parts.push(`${pay} need${pay === 1 ? 's' : ''} a $0.99 renewal — your plan's included renewals are used up. You can renew from My Market.`);
      if (!parts.length) parts.push('Nothing needed doing — everything was already in that state.');
      setSettled((s) => ({ ...s, [p.action_id]: true }));
      setTurns((t) => [...t, { role: 'assistant', content: parts.join(' ') }]);
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
        aria-label={open ? 'Close the Gnome assistant' : 'Ask Gnome — your garden assistant'}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) logWeb('gnome_opened', { page: pathname });
        }}
      >
        <GnomeMascot size={44} />
      </button>

      {open && (
        <div className="gnome-panel" role="dialog" aria-label="Gnome assistant chat">
          <div className="gp-head">
            <GnomeMascot size={30} />
            <div>
              <strong>Gnome</strong>
              <span className="gp-sub">your garden &amp; market helper</span>
            </div>
            <button className="gp-close" aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="gp-log" ref={logRef}>
            {turns.length === 0 && (
              <div className="bubble assistant">
                Hey, I’m Gnome. What are we working on? I can help with growing,
                finding local food, selling, plans — or just how this place works.
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i}>
                <div className={`bubble ${t.role === 'user' ? 'user' : 'assistant'}`}>{t.content}</div>
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
                    border: '1px solid var(--leaf, #4a7c46)', display: 'grid', gap: 6,
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
              </div>
            ))}
            {busy && <div className="bubble assistant thinking">Checking the garden gates…</div>}
            {note && <p className="autherror" style={{ margin: '4px 0 0' }}>{note}</p>}
          </div>

          {ready && !session ? (
            <div className="gp-auth">
              <SignInCard
                title="Sign in to chat with Gnome"
                blurb="One code by email — then the gnome is all yours. Free during beta."
              />
            </div>
          ) : (
            <>
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
                <input
                  value={input}
                  placeholder="Ask about growing, selling, plans…"
                  maxLength={1500}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(input); }}
                />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void send(input)}>
                  Send
                </button>
              </div>
              <p className="gp-fine">
                Gnome can answer questions and, when you ask plainly, update your own
                listings — bigger changes always wait for your Confirm. It never touches
                billing. Garden advice depends on your real conditions.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
