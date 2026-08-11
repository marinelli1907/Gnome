'use client';

// AI garden planner chat. Signed-in only (the edge function is JWT-gated as the
// cost gate), so the page doubles as a warm sign-up funnel: the plan is the hook.
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

interface Turn { role: 'user' | 'assistant'; content: string }

// Downscale a plant photo before shipping it to the vision-enabled planner.
async function toJpegB64(file: File, maxDim = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

const STARTERS = [
  'What should I plant right now?',
  'Plan a 4×8 raised bed for salads',
  'What can I still start from seed this month?',
  'Low-effort crops for a beginner?',
];

// Tiny markdown renderer for the planner's replies (### headers, - bullets,
// **bold**). Deliberately minimal — anything unrecognized renders as a paragraph.
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length === 0) return null;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}
            </ul>
          );
        }
        return lines.map((l, li) => {
          const h = l.match(/^(#{1,4})\s+(.*)$/);
          if (h) return <h4 key={`${bi}-${li}`}>{inline(h[2])}</h4>;
          return <p key={`${bi}-${li}`}>{inline(l)}</p>;
        });
      })}
    </>
  );
}
function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
  );
}

export default function GardenClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [location, setLocation] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedDrop, setSeedDrop] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // Seed Drop → Planner: pull the exact varieties from the user's latest
  // order so nobody retypes what Gnome itself shipped them.
  useEffect(() => {
    if (!uid) return;
    supabaseBrowser()
      .from('seed_orders')
      .select('id,status,items:seed_order_items(status,product:seed_products!seed_order_items_seed_product_id_fkey(crop,variety))')
      .eq('user_id', uid)
      .in('status', ['selected', 'packed', 'shipped'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const items = (data?.items ?? []) as unknown as { status: string; product: { crop: string; variety: string } | null }[];
        setSeedDrop(
          items
            .filter((i) => i.status !== 'released' && i.product)
            .map((i) => `${i.product!.crop} '${i.product!.variety}'`),
        );
      });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    supabaseBrowser()
      .from('profiles')
      .select('city,state')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.city) setLocation((l) => l || `${data.city}, ${data.state ?? 'OH'}`);
      });
  }, [uid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function ask(question: string, photoB64?: string) {
    const q = question.trim();
    if (!q || busy) return;
    if (!location.trim()) {
      setError('First tell the planner where your garden is (city + state).');
      return;
    }
    setError(null);
    const nextTurns: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(nextTurns);
    setInput('');
    setBusy(true);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke('garden-planner', {
        body: {
          location: location.trim(),
          messages: nextTurns,
          ...(photoB64 ? { imageBase64: photoB64, mediaType: 'image/jpeg' } : {}),
        },
      });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'The planner isn’t available right now.');
      }
      if (!data?.reply) throw new Error(data?.error ?? 'No plan came back — try again.');
      setTurns([...nextTurns, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The planner hit a snag — try again.');
      setTurns(turns); // roll the question back so it can be retried
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;

  if (!session) {
    return (
      <SignInCard
        title="Sign in to use the garden planner"
        blurb="Free while Gnome is in beta. One code by email and you'll get a planting plan for your exact town and week."
      />
    );
  }

  return (
    <div className="planner">
      <div className="field">
        <label>Where’s your garden?</label>
        <input
          value={location}
          placeholder="City, State"
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      {turns.length === 0 && seedDrop.length > 0 && (
        <div className="preview-note" style={{ margin: 0 }}>
          🌱 <strong>Your Seed Drop:</strong> {seedDrop.join(', ')}.{' '}
          <button
            className="linkbtn"
            onClick={() => void ask(
              `I received a Gnome Seed Drop with: ${seedDrop.join(', ')}. Build me a planting plan for these exact seeds — order of planting, timing for my location, and spacing.`,
            )}
          >
            Build my planting plan →
          </button>
        </div>
      )}

      {turns.length === 0 && (
        <div className="chips planner-starters">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => void ask(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="chatlog">
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.role === 'assistant' ? <Markdown text={t.content} /> : t.content}
          </div>
        ))}
        {busy && <div className="bubble assistant thinking">Checking your zone and the calendar… 🌱</div>}
        <div ref={endRef} />
      </div>

      {error && <p className="autherror">{error}</p>}

      <form
        className="authrow"
        onSubmit={(e) => { e.preventDefault(); void ask(input); }}
      >
        <input
          value={input}
          placeholder={turns.length === 0 ? 'Ask anything about your garden…' : 'Ask a follow-up…'}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Ask'}
        </button>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          id="plant-photo-input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f || busy) return;
            try {
              const b64 = await toJpegB64(f);
              void ask(input.trim() || '📷 What’s wrong with this plant? Please diagnose from the photo.', b64);
            } catch {
              setError('Couldn’t read that photo — try another one.');
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          title="Snap or upload a plant photo for a diagnosis"
          onClick={() => document.getElementById('plant-photo-input')?.click()}
        >
          🌿 Check a plant
        </button>
      </form>
    </div>
  );
}
