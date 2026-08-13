// Gnome — the AI tab. One assistant with two jobs:
//
//   { action: "chat" }               gardening & farming knowledge, what's
//                                    happening in the caller's market, an
//                                    opinion on what to sell and why, and help
//                                    using the app. Grounded in REAL aggregate
//                                    data (see marketIntel) — never invented
//                                    numbers, never another user's PII.
//
//   { action: "draft_from_photos" }  the assistant's only "arm": turn 1..N
//                                    photos into 1..N listing DRAFTS. Each
//                                    photo becomes its own draft, so a bulk
//                                    upload of different items produces
//                                    different listings. Nothing is published —
//                                    drafts land in listing_drafts and the
//                                    owner approves, edits, or discards them.
//
// Safety carried over from the rest of the AI stack:
//   * ai_settings.reads_enabled=false halts all provider spend.
//   * Per-image atomic slot reservation via ai_reserve_slot BEFORE any spend.
//   * Photo drafting requires an effective paid plan (market_effective_plan),
//     matching the AI Listing Assistant entitlement. Chat is open to any
//     signed-in user under a daily cap.
//   * Model output is STRUCTURED JSON, validated field by field; taxonomy is
//     matched against the real tree so the AI cannot invent categories.
//   * Images are analyzed in memory and never stored by this function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  MODELS, type ModelRef, type Turn as PTurn, providerKeys, callWithFallback,
  estCents, actualCents, RateLimitedError,
} from './providers.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TURNS = 12;
const MAX_TURN_CHARS = 1500;
const MAX_IMAGES = 10;

const CHAT_SYSTEM = `You are Gnome — a knowledgeable, warm garden gnome inside the Gnome Farmers Market app, a neighborhood marketplace for home-grown food.

You help with four things:
1. GROWING — vegetables, fruit, herbs, eggs, honey, preserves, soil, pests, timing, harvest and storage. Be genuinely useful and specific. Give real numbers (spacing, depth, days to maturity, pH) when you know them.
2. THEIR MARKET — what is actually happening around them. Use MARKET INTEL below; it is real data. Never invent counts, prices, or trends. If the intel is thin, say so plainly.
3. WHAT TO SELL AND WHY — give a clear opinion, with the reason. Lean on demand signals (open Wanted posts), supply gaps (categories few neighbors list), the season, and their plan's listing headroom. Say the reasoning out loud so they can judge it.
4. USING THE APP — how to post, promote, set pickup, handle requests, delivery, Seed Drop, plans.

STYLE: warm, plain text, no markdown, no asterisks or headers. Conversational. Usually 2–6 sentences; use a short plain list only when genuinely listing things. Sparing dry humor. Never childish, never salesy.

WHAT YOU CAN DO: you can create listing DRAFTS from photos. If they want to list something, tell them to add photos in this tab and you will draft each one — one photo, one listing — for them to review. Say plainly that you prepare drafts and they approve them; you never publish anything by yourself.

HARD RULES:
- Never claim to have changed, published, paused, or deleted anything. You only prepare drafts.
- Never reveal or guess another user's data, address, or contact details. Aggregate counts in MARKET INTEL are fine to discuss; individuals are not.
- Pesticides, food safety, cottage-food and licensing questions: be careful, point to the product label, the Trust page, and their county extension office or state ag department. No definitive legal rulings.
- Pricing advice: give a range and say it depends on local conditions. Gnome takes 0% of neighbor-to-neighbor sales.
- If you do not know, say so.`;

const VISION_PROMPT = `You help a neighbor list what they grew or made on a local farmers-market app.
This photo is ONE listing. Reply with ONLY a JSON object (no markdown):
{
 "candidate_name": "Roma tomatoes",
 "confidence": 0.0-1.0,
 "alternatives": ["cherry tomatoes"],
 "suggested_title": "Fresh Roma tomatoes",
 "suggested_description": "2-3 warm human sentences a real gardener would write. First person, friendly, specific to what is visible (color, ripeness, size). No hype words, no emoji, never mention AI.",
 "taxonomy_search_terms": ["tomato", "roma"],
 "suggested_unit": "lb|each|bunch|dozen|jar|basket",
 "suggested_price_cents": 400,
 "suggested_listing_type": "sale",
 "possible_quantity": "about 8 tomatoes",
 "compliance_attention_required": false,
 "seller_questions": ["Are these fully ripe or a few days out?"]
}
compliance_attention_required is true for eggs, meat, dairy, or anything canned/preserved — things commonly regulated.
If nothing sellable is visible, use confidence 0 and empty strings.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const t0 = Date.now();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(401, { error: 'UNAUTHENTICATED' });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'chat');

    // Global read-side kill switch + provider chain.
    const { data: settings } = await admin.from('ai_settings')
      .select('reads_enabled, allow_paid_fallback, listing_daily_limit').limit(1).maybeSingle();
    if (settings?.reads_enabled === false) {
      return json(503, { error: 'AI_PAUSED', message: 'Gnome AI is paused right now.' });
    }
    const keys = providerKeys();
    const allowPaid = settings?.allow_paid_fallback === true;
    const chainFor = (visiony: boolean): ModelRef[] => {
      const c: ModelRef[] = [];
      if (keys.gemini) c.push({ provider: 'gemini', model: visiony ? MODELS.vision : MODELS.lite });
      if (allowPaid && keys.openai) c.push({ provider: 'openai', model: visiony ? 'gpt-4o' : 'gpt-4o-mini' });
      if (allowPaid && keys.anthropic) c.push({ provider: 'anthropic', model: 'claude-haiku-4-5' });
      return c;
    };

    // -----------------------------------------------------------------------
    // ARM: photos -> drafts (one draft per photo).
    // -----------------------------------------------------------------------
    if (action === 'draft_from_photos') {
      const images: { image_base64?: string; media_type?: string; photo_url?: string }[] =
        Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
      if (!images.length) return json(400, { error: 'NO_IMAGES' });

      const { data: mkt } = await admin.from('markets').select('id').eq('owner_id', uid).limit(1).maybeSingle();
      if (!mkt) return json(403, { error: 'NO_MARKET', message: 'Post once to create your Market first.' });
      const { data: ep } = await admin.rpc('market_effective_plan', { p_market: mkt.id });
      const eff = Array.isArray(ep) ? ep[0] : ep;
      if (!eff || eff.plan === 'free') {
        return json(403, { error: 'PLAN_REQUIRED', message: 'Drafting listings from photos is a Grower & Farm feature.' });
      }
      const chain = chainFor(true);
      if (!chain.length) return json(503, { error: 'AI_UNAVAILABLE', message: 'AI isn’t configured yet.' });

      // Real taxonomy tree, fetched once for the whole batch.
      const { data: nodes } = await admin
        .from('marketplace_taxonomy_nodes').select('id,name,path,search_synonyms').eq('active', true);

      const batchId = crypto.randomUUID();
      const cap = settings?.listing_daily_limit ?? 20;
      const created: unknown[] = [];
      const skipped: { index: number; reason: string }[] = [];

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img?.image_base64 || String(img.image_base64).length > 8_000_000) {
          skipped.push({ index: i, reason: 'BAD_IMAGE' }); continue;
        }
        // Atomic per-image reservation BEFORE spend — a 10-photo batch cannot
        // outrun the daily cap.
        const { data: reserved } = await admin.rpc('ai_reserve_slot', {
          p_uid: uid, p_feature: 'listing_assistant', p_cap: cap,
        });
        if (!reserved) { skipped.push({ index: i, reason: 'DAILY_LIMIT' }); continue; }

        let raw = ''; let provider = ''; let model = ''; let inTok = 0; let outTok = 0;
        try {
          const r = await callWithFallback(chain, {
            system: 'You identify garden produce and homemade goods for a neighborly farmers-market app.',
            turns: [{ role: 'user', parts: [
              { imageB64: img.image_base64, mediaType: img.media_type || 'image/jpeg' },
              { text: VISION_PROMPT },
            ] }],
            maxTokens: 1100, json: true,
          });
          raw = r.text; provider = r.provider; model = r.model; inTok = r.inTok; outTok = r.outTok;
        } catch (e) {
          skipped.push({ index: i, reason: e instanceof RateLimitedError ? 'AI_BUSY' : 'ANALYZE_FAILED' });
          continue;
        }

        const p = parseLoose(raw);
        if (!p) { skipped.push({ index: i, reason: 'BAD_MODEL_OUTPUT' }); continue; }

        const confidence = num(p.confidence, 0, 1);
        const title = str(p.suggested_title, 80) || str(p.candidate_name, 80);
        if (!title || confidence === 0) { skipped.push({ index: i, reason: 'NOT_RECOGNIZED' }); continue; }

        // Taxonomy from the REAL tree — the model only supplies search terms.
        const terms = [str(p.candidate_name, 80), ...arr(p.alternatives, 5, 60), ...arr(p.taxonomy_search_terms, 6, 40)]
          .filter(Boolean).map((s) => s.toLowerCase());
        const best = (nodes ?? []).map((n) => {
          const hay = [String(n.name).toLowerCase(), ...((n.search_synonyms ?? []) as string[]).map((s) => s.toLowerCase())];
          let score = 0;
          for (const t of terms) for (const h of hay) {
            if (h === t) score += 3; else if (h.includes(t) || t.includes(h)) score += 1;
          }
          return { id: n.id, path: n.path as string, score };
        }).filter((n) => n.score > 0).sort((a, b) => b.score - a.score)[0] ?? null;

        const lt = ['sale', 'free', 'trade'].includes(String(p.suggested_listing_type))
          ? String(p.suggested_listing_type) : 'sale';

        const { data: draft, error: derr } = await admin.from('listing_drafts').insert({
          owner_id: uid, market_id: mkt.id, batch_id: batchId, source: 'ai_photo',
          title,
          description: str(p.suggested_description, 600),
          category: best ? String(best.path).split('/')[0] : 'produce',
          taxonomy_node_id: best?.id ?? null,
          listing_type: lt,
          price_cents: lt === 'sale' ? Math.round(num(p.suggested_price_cents, 0, 100000)) : null,
          unit: str(p.suggested_unit, 20),
          quantity: str(p.possible_quantity, 60),
          photos: img.photo_url ? [String(img.photo_url).slice(0, 500)] : [],
          ai_confidence: confidence,
          ai_candidate_name: str(p.candidate_name, 80),
          ai_alternatives: arr(p.alternatives, 5, 60),
          ai_seller_questions: arr(p.seller_questions, 3, 120),
          compliance_attention: p.compliance_attention_required === true,
        }).select('*').single();
        if (derr) { skipped.push({ index: i, reason: 'SAVE_FAILED' }); continue; }
        created.push(draft);

        admin.from('ai_usage_log').insert({
          feature: 'listing_assistant', user_id: uid, market_id: mkt.id,
          effective_plan: eff.plan, provider, model, images: 1,
          input_tokens: inTok, output_tokens: outTok,
          estimated_cost_cents: estCents(model, inTok, outTok),
          actual_cost_cents: actualCents(provider as 'gemini' | 'openai' | 'anthropic', model, inTok, outTok),
          free_tier: provider === 'gemini', duration_ms: Date.now() - t0, success: true,
        }).then(() => {}, () => {});
      }

      return json(200, { batch_id: batchId, drafts: created, skipped });
    }

    // -----------------------------------------------------------------------
    // CHAT
    // -----------------------------------------------------------------------
    const chain = chainFor(false);
    if (!chain.length) return json(503, { error: 'AI_UNAVAILABLE', message: 'AI isn’t configured yet.' });

    // Daily cap (paid plans get more) — same helper the site assistant uses.
    const { data: mkt2 } = await admin.from('markets').select('id,plan,name').eq('owner_id', uid).limit(1).maybeSingle();
    const paid = !!mkt2?.plan && mkt2.plan !== 'free';
    const { data: allowed, error: capErr } = await admin.rpc('ai_usage_increment', {
      p_user: uid, p_feature: 'assistant', p_cap: paid ? 50 : 20,
    });
    if (!capErr && allowed === false) {
      return json(429, { error: 'DAILY_LIMIT', message: 'You’ve used today’s chat allowance — it resets tomorrow.' });
    }

    const messages: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];
    const turns: PTurn[] = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role as 'user' | 'assistant', parts: [{ text: m.content.slice(0, MAX_TURN_CHARS) }] }));
    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      return json(400, { error: 'EMPTY', message: 'Say something first.' });
    }

    const intel = await marketIntel(admin, uid, mkt2);

    let r;
    try {
      r = await callWithFallback(chain, {
        system: `${CHAT_SYSTEM}\n\nMARKET INTEL (real data about this user and their area; aggregate only):\n${intel}`,
        turns, maxTokens: 700,
      });
    } catch (e) {
      if (e instanceof RateLimitedError) return json(503, { error: 'AI_BUSY', message: 'Gnome AI is busy. Try again shortly.' });
      throw e;
    }
    const reply = r.text.trim();
    if (!reply) throw new Error('empty completion');

    // Persist the exchange so the tab keeps a real history.
    const lastUser = turns[turns.length - 1].parts[0].text ?? '';
    admin.from('ai_chat_messages').insert([
      { user_id: uid, role: 'user', content: lastUser.slice(0, 4000) },
      { user_id: uid, role: 'assistant', content: reply.slice(0, 4000) },
    ]).then(() => {}, () => {});

    admin.from('ai_usage_log').insert({
      feature: 'assistant', user_id: uid, provider: r.provider, model: r.model,
      input_tokens: r.inTok, output_tokens: r.outTok,
      estimated_cost_cents: estCents(r.model, r.inTok, r.outTok),
      actual_cost_cents: actualCents(r.provider, r.model, r.inTok, r.outTok),
      free_tier: r.provider === 'gemini', duration_ms: Date.now() - t0, success: true,
    }).then(() => {}, () => {});

    return json(200, { reply });
  } catch (e) {
    console.error('gnome-assistant:', e);
    return json(502, { error: 'ASSISTANT_FAILED', message: 'The gnome tripped over a root — try again in a moment.' });
  }
});

// Real, aggregate-only context. Nothing here identifies another user: counts
// and category names only, scoped to the caller's state/county.
async function marketIntel(
  admin: ReturnType<typeof createClient>,
  uid: string,
  mkt: { id: string; plan: string; name: string } | null,
): Promise<string> {
  const lines: string[] = [];
  try {
    const { data: prof } = await admin.from('profiles').select('city,county,state').eq('id', uid).maybeSingle();
    const where = [prof?.city, prof?.county, prof?.state].filter(Boolean).join(', ');

    if (mkt) {
      const { count: active } = await admin.from('listings')
        .select('id', { count: 'exact', head: true }).eq('market_id', mkt.id).eq('status', 'active');
      const { data: ent } = await admin.rpc('market_effective_plan', { p_market: mkt.id });
      const eff = Array.isArray(ent) ? ent[0] : ent;
      const { data: lim } = await admin.from('plan_limits')
        .select('max_active_listings').eq('plan', eff?.plan ?? mkt.plan).maybeSingle();
      const capTxt = lim?.max_active_listings == null ? 'unlimited' : String(lim.max_active_listings);
      lines.push(`The user's Market "${mkt.name}" is on the ${eff?.plan ?? mkt.plan} plan with ${active ?? 0} active listing(s); their plan allows ${capTxt}.`);
    } else {
      lines.push('The user has no Market yet — they create one by posting their first item from the Post tab.');
    }
    if (where) lines.push(`They are near ${where}.`);

    // Pending AI drafts waiting on them.
    const { count: pending } = await admin.from('listing_drafts')
      .select('id', { count: 'exact', head: true }).eq('owner_id', uid).eq('status', 'pending');
    if (pending) lines.push(`They have ${pending} AI listing draft(s) waiting for review in this tab.`);

    // SUPPLY: what neighbours in the same state are actively listing.
    if (prof?.state) {
      const { data: sup } = await admin.from('listings')
        .select('category').eq('status', 'active').eq('state', prof.state).limit(500);
      const tally = new Map<string, number>();
      for (const r of sup ?? []) {
        const c = String((r as { category: string }).category || '').trim();
        if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (top.length) {
        lines.push(`Active listings near them by category: ${top.map(([c, n]) => `${c} ${n}`).join(', ')}. Categories NOT in this list are largely unserved locally.`);
      } else {
        lines.push('There are very few active listings near them yet — the area is early, so almost anything is an opening.');
      }

      // DEMAND: open Wanted posts are the strongest "what to sell" signal.
      const { data: wanted } = await admin.from('listings')
        .select('title,category').eq('status', 'active').eq('kind', 'wanted').eq('state', prof.state).limit(25);
      if (wanted?.length) {
        const w = wanted.slice(0, 10).map((x) => String((x as { title: string }).title)).join('; ');
        lines.push(`Open Wanted posts near them (${wanted.length} total) — real unmet demand: ${w}.`);
      } else {
        lines.push('No open Wanted posts near them right now.');
      }
    }

    const month = new Date().toLocaleString('en-US', { month: 'long' });
    lines.push(`Current month: ${month}.`);
  } catch {
    return 'No market intel available right now — answer from general knowledge and say the local data is unavailable.';
  }
  return lines.join('\n');
}

// Tolerant JSON extraction. Vision replies occasionally arrive fenced, with a
// stray preamble, or truncated at the token ceiling mid-string. Take the widest
// {...} span; if that still fails, close any unterminated string/braces so a
// long description doesn't cost the whole photo. Returns null only when there
// is genuinely nothing parseable — the caller then skips that image rather than
// inventing a listing.
function parseLoose(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  const span = end > start ? cleaned.slice(start, end + 1) : null;
  for (const attempt of [span, repairTruncated(cleaned.slice(start))]) {
    if (!attempt) continue;
    try {
      const v = JSON.parse(attempt);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* try the next candidate */ }
  }
  return null;
}

function repairTruncated(s: string): string | null {
  // Track the real delimiter stack so an array truncated mid-element is closed
  // with ']' and an object with '}' — closing with the wrong one just fails.
  const stack: string[] = [];
  let inStr = false; let esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!stack.length && !inStr) return null;   // nothing to repair
  let out = s;
  if (inStr) out += '"';
  // Drop a trailing comma or a dangling `"key":` so the close is valid JSON.
  out = out.replace(/,\s*$/, '').replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function num(v: unknown, lo: number, hi: number): number {
  const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
}
function arr(v: unknown, maxLen: number, maxStr: number): string[] {
  return Array.isArray(v) ? v.slice(0, maxLen).map((x) => str(x, maxStr)).filter(Boolean) : [];
}
