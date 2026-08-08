'use client';

// The gnome in the corner — Gnome's site-wide AI assistant.
// Launcher is always present (small, calm, never auto-opens); the panel
// mounts on first open. All model calls go through the ask-gnome edge
// function (JWT-gated, per-day caps, server-held API key). Logged-out
// visitors get the sign-in card inside the panel. The assistant is
// read-only and says so — it never pretends to change account state.
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { GnomeMascot } from './art';
import { SignInCard, useSession } from './auth';

interface Turn { role: 'user' | 'assistant'; content: string }

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
    chips: ['Which seed pack fits me?', 'What’s a hardiness zone?', 'What can I plant this month?'],
  },
  {
    match: (p) => p.startsWith('/plots'),
    chips: ['How do plot reservations work?', 'What happens if a crop fails?', 'How do I offer a plot?'],
  },
  {
    match: (p) => p.startsWith('/pricing'),
    chips: ['Which plan fits me?', 'Does Gnome take a percentage?', 'What does Grower include?'],
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
      setTurns([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Something went sideways — try again shortly.');
      setTurns(next); // keep the user's message; they can retry
    } finally {
      setBusy(false);
    }
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
              <div key={i} className={`bubble ${t.role === 'user' ? 'user' : 'assistant'}`}>{t.content}</div>
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
                Gnome answers questions — it can’t change listings or billing. Garden
                advice depends on your real conditions.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
