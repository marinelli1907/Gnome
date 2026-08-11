// Gnome — AI Listing Assistant (photo → structured draft).
//
// POST { image_base64, media_type? } with the caller's JWT.
// Entitlement is resolved SERVER-SIDE from market_effective_plan (paid or
// complimentary Grower/Farm/Sponsor — never "a Stripe sub exists").
// Provider-neutral: Anthropic first, OpenAI fallback (keys are function
// secrets; clients never see them). The model returns STRUCTURED JSON only;
// taxonomy candidates are matched against the real tree — the AI cannot
// invent nodes. Every call is logged to ai_usage_log; a per-user daily cap
// comes from ai_settings.listing_daily_limit. Images are analyzed in memory
// and never stored. The description prompt aims for a warm, neighborly voice.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SCHEMA_PROMPT = `You help a neighbor sell what they grew or made at a local farmers market app.
Look at the photo and reply with ONLY a JSON object (no markdown) shaped exactly like:
{
 "candidate_name": "Roma tomatoes",
 "confidence": 0.0-1.0,
 "alternatives": ["cherry tomatoes"],
 "suggested_title": "Fresh Roma tomatoes",
 "suggested_description": "2-3 warm human sentences a real gardener would write. First person, friendly, specific to what is visible (color, ripeness, size). No hype words like 'delicious artisanal premium', no emoji spam, no 'AI'.",
 "taxonomy_search_terms": ["tomato", "roma"],
 "suggested_unit": "lb|each|bunch|dozen|jar|basket",
 "suggested_price_range": "$3-$5/lb",
 "suggested_price_cents": 400,
 "suggested_listing_type": "sale",
 "possible_quantity": "about 8 tomatoes",
 "compliance_attention_required": false,
 "seller_questions": ["Are these fully ripe or a few days out?"],
 "multiple_items": [{"name": "zucchini", "search_terms": ["zucchini"]}]
}
multiple_items lists OTHER distinct sellable products visible (empty array if just one).
If you cannot identify anything sellable, use confidence 0 and empty fields.`;

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  try {
    const { image_base64, media_type } = await req.json();
    if (!image_base64 || String(image_base64).length > 8_000_000) {
      return json({ error: 'BAD_IMAGE' }, 400);
    }
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // Caller identity from JWT — never from the payload.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json({ error: 'UNAUTHENTICATED' }, 401);

    // Server-side entitlement: effective plan (paid OR complimentary) ≠ free.
    const { data: mkt } = await admin.from('markets').select('id').eq('owner_id', uid).limit(1).maybeSingle();
    if (!mkt) return json({ error: 'NO_MARKET', message: 'Post once to create your Market first.' }, 403);
    const { data: ep } = await admin.rpc('market_effective_plan', { p_market: mkt.id });
    const eff = Array.isArray(ep) ? ep[0] : ep;
    if (!eff || eff.plan === 'free') {
      return json({ error: 'PLAN_REQUIRED', message: 'The AI Listing Assistant is a Grower & Farm feature.' }, 403);
    }

    // Daily cap.
    const { data: settings } = await admin.from('ai_settings').select('listing_daily_limit').limit(1).maybeSingle();
    const cap = settings?.listing_daily_limit ?? 20;
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { count } = await admin.from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('feature', 'listing_assistant')
      .gte('created_at', since.toISOString());
    if ((count ?? 0) >= cap) return json({ error: 'DAILY_LIMIT', message: 'Daily AI listing limit reached — try again tomorrow.' }, 429);

    // Provider call (Anthropic primary, OpenAI fallback).
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
    const openaiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
    let raw = ''; let provider = ''; let model = '';
    let inputTokens = 0; let outputTokens = 0;
    const mt = media_type || 'image/jpeg';
    if (anthropicKey) {
      provider = 'anthropic'; model = 'claude-sonnet-5';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 900,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mt, data: image_base64 } },
            { type: 'text', text: SCHEMA_PROMPT },
          ] }],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      raw = body.content?.[0]?.text ?? '';
      inputTokens = body.usage?.input_tokens ?? 0; outputTokens = body.usage?.output_tokens ?? 0;
    } else if (openaiKey) {
      provider = 'openai'; model = 'gpt-4o';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 900,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${mt};base64,${image_base64}` } },
            { type: 'text', text: SCHEMA_PROMPT },
          ] }],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`openai ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      raw = body.choices?.[0]?.message?.content ?? '';
      inputTokens = body.usage?.prompt_tokens ?? 0; outputTokens = body.usage?.completion_tokens ?? 0;
    } else {
      return json({ error: 'AI_UNAVAILABLE', message: 'AI isn’t configured yet — create your listing manually.' }, 503);
    }

    // Validate structure — never pipe prose into the app.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ''));
    } catch {
      throw new Error('MODEL_OUTPUT_NOT_JSON');
    }
    const draft = {
      candidate_name: str(parsed.candidate_name, 80),
      confidence: num(parsed.confidence, 0, 1),
      alternatives: arr(parsed.alternatives, 5, 60),
      suggested_title: str(parsed.suggested_title, 80),
      suggested_description: str(parsed.suggested_description, 600),
      taxonomy_search_terms: arr(parsed.taxonomy_search_terms, 6, 40),
      suggested_unit: str(parsed.suggested_unit, 20),
      suggested_price_range: str(parsed.suggested_price_range, 40),
      suggested_price_cents: Math.round(num(parsed.suggested_price_cents, 0, 100000)),
      suggested_listing_type: ['sale', 'free', 'trade'].includes(String(parsed.suggested_listing_type)) ? String(parsed.suggested_listing_type) : 'sale',
      possible_quantity: str(parsed.possible_quantity, 60),
      compliance_attention_required: parsed.compliance_attention_required === true,
      seller_questions: arr(parsed.seller_questions, 3, 120),
      multiple_items: Array.isArray(parsed.multiple_items)
        ? (parsed.multiple_items as { name?: unknown; search_terms?: unknown }[]).slice(0, 4).map((m) => ({
            name: str(m.name, 60), search_terms: arr(m.search_terms, 4, 40),
          }))
        : [],
    };

    // Taxonomy resolution against the REAL tree (AI cannot invent nodes).
    const { data: nodes } = await admin
      .from('marketplace_taxonomy_nodes')
      .select('id,name,path,search_synonyms')
      .eq('active', true);
    const terms = [draft.candidate_name, ...draft.alternatives, ...draft.taxonomy_search_terms]
      .filter(Boolean).map((s) => String(s).toLowerCase());
    const scored = (nodes ?? []).map((n) => {
      const hay = [n.name.toLowerCase(), ...(n.search_synonyms ?? []).map((s: string) => s.toLowerCase())];
      let score = 0;
      for (const t of terms) for (const h of hay) {
        if (h === t) score += 3;
        else if (h.includes(t) || t.includes(h)) score += 1;
      }
      return { id: n.id, path: n.path, name: n.name, score };
    }).filter((n) => n.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    await admin.from('ai_usage_log').insert({
      feature: 'listing_assistant', user_id: uid, market_id: mkt.id,
      effective_plan: eff.plan, provider, model, images: 1,
      input_tokens: inputTokens, output_tokens: outputTokens,
      estimated_cost_cents: Math.round((inputTokens * 0.0003 + outputTokens * 0.0015) * 100) / 100,
      duration_ms: Date.now() - t0, success: true,
    });

    return json({ draft, taxonomy_candidates: scored });
  } catch (e) {
    try {
      const admin2 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await admin2.from('ai_usage_log').insert({
        feature: 'listing_assistant', success: false, duration_ms: Date.now() - t0,
      });
    } catch { /* best-effort */ }
    console.error('analyze-listing-photo:', e);
    return json({ error: 'ANALYZE_FAILED', message: 'Gnome couldn’t confidently identify this item.' }, 502);
  }
});

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function num(v: unknown, lo: number, hi: number): number {
  const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
}
function arr(v: unknown, maxLen: number, maxStr: number): string[] {
  return Array.isArray(v) ? v.slice(0, maxLen).map((x) => str(x, maxStr)).filter(Boolean) : [];
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
