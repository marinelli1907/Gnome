// Gnome — AI listing draft ("snap a photo, we write the listing").
//
// The app sends the first listing photo (base64) + the chosen listing type;
// Claude identifies the produce/goods and returns a structured draft: title,
// category, description, and (for sales) a conservative price suggestion.
// The user always reviews and can edit everything — this drafts, never posts.
//
// Provider: GEMINI FREE TIER FIRST via ./providers.ts (gemini-3.6-flash
// multimodal, JSON response mode + server-side validation). Paid providers
// only when ai_settings.allow_paid_fallback=true.
//
// verify_jwt stays ON (default): only signed-in users can call this, which is
// also the cost gate — anonymous traffic never reaches the model.

import {
  MODELS, type ModelRef, providerKeys, callWithFallback,
  estCents, actualCents, RateLimitedError,
} from './providers.ts';

// --- Cost gate: real signed-in users only, capped per day. -----------------
// Verify the caller through Supabase Auth before service-role reads or metering;
// decoded JWT claims are never trusted as identity on this legacy endpoint.
import { createClient } from 'npm:@supabase/supabase-js@2';

async function verifiedUserIdFrom(req: Request): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return null;
  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

// Shared Zordy allowance: this legacy listing-draft endpoint consumes the same
// daily bucket as the main assistant.
async function underDailyCap(userId: string): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data, error } = await admin.rpc('zordy_reserve_request', { p_user: userId });
  if (error) {
    console.error('zordy_reserve_request error:', error);
    return false;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.allowed !== false;
}

async function releaseDailyCap(userId: string): Promise<void> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  await admin.rpc('zordy_release_request', { p_user: userId }).then(() => {}, () => {});
}


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Keep in sync with expo/constants/categories.ts and web/lib/categories.ts.
const CATEGORY_IDS = [
  'vegetables', 'fruit', 'herbs', 'eggs', 'seeds', 'plants',
  'flowers', 'compost', 'honey', 'farm_fresh', 'supplies', 'decor', 'wood', 'meat', 'other',
] as const;

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Short, appealing listing title, max ~50 chars. E.g. "Fresh cherry tomatoes" or "Raw wildflower honey".',
    },
    category: { type: 'string', enum: [...CATEGORY_IDS] },
    description: {
      type: 'string',
      description: 'One or two friendly, neighborly sentences about what is shown. No emoji spam, no marketing hype.',
    },
    suggested_price_cents: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description: 'Conservative typical local price in US cents for the natural unit, or null if unsure.',
    },
    suggested_unit: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Natural selling unit like "dozen", "lb", "jar", "bunch", "each" — or null.',
    },
  },
  required: ['title', 'category', 'description', 'suggested_price_cents', 'suggested_unit'],
  additionalProperties: false,
} as const;

const SYSTEM = `You draft marketplace listings for Gnome, a hyperlocal neighbor-to-neighbor app for garden surplus, eggs, honey, flowers, plants, and small farm-stand goods anywhere in the United States.

Voice: a friendly neighbor, not a store. Plain, warm, concrete. Never invent details you can't see (variety names, "organic", weights). Never make food-safety claims.

Pricing: suggest a conservative, typical local price only when the item and unit are obvious (e.g. eggs by the dozen, honey by the jar); otherwise null. Prices are informal neighbor prices, not retail.

If the photo doesn't show something a neighbor would share, trade, or sell (produce, garden goods, eggs, honey, flowers, plants, firewood, carving or lumber wood, farm-raised meat, compost, preserves), still do your best with a generic but honest draft and category "other".`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  let reservedUser: string | null = null;
  try {
    const userId = await verifiedUserIdFrom(req);
    if (!userId) {
      return json({ error: 'Sign in to use AI drafting.' }, 401);
    }

    const cfgClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: settings } = await cfgClient.from('ai_settings')
      .select('reads_enabled, allow_paid_fallback').limit(1).maybeSingle();
    if (settings?.reads_enabled === false) {
      return json({ error: 'AI drafting is paused right now — fill the form by hand for now.' }, 503);
    }
    const keys = providerKeys();
    const chain: ModelRef[] = [];
    if (keys.gemini) chain.push({ provider: 'gemini', model: MODELS.vision });
    if (settings?.allow_paid_fallback === true && keys.openai) chain.push({ provider: 'openai', model: 'gpt-4o' });
    if (settings?.allow_paid_fallback === true && keys.anthropic) chain.push({ provider: 'anthropic', model: 'claude-sonnet-5' });
    if (!chain.length) {
      return json({ error: 'AI drafting is not configured yet.' }, 503);
    }
    const { imageBase64, mediaType, listingType } = await req.json();
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      return json({ error: 'imageBase64 required' }, 400);
    }
    if (imageBase64.length > 8_000_000) {
      return json({ error: 'Image too large — pick a smaller photo.' }, 413);
    }
    const media = ALLOWED_MEDIA.includes(mediaType) ? mediaType : 'image/jpeg';
    const type = ['free', 'trade', 'sale', 'wanted'].includes(listingType) ? listingType : 'free';
    if (!(await underDailyCap(userId))) {
      return json({ error: "You've used today's Zordy requests. Come back tomorrow or upgrade for more." }, 429);
    }
    reservedUser = userId;

    const t0 = Date.now();
    const r = await callWithFallback(chain, {
      system: SYSTEM + `\n\nReply with ONLY a JSON object shaped exactly like:
{"title": "Short appealing title, max ~50 chars",
 "category": one of ${JSON.stringify(CATEGORY_IDS)},
 "description": "One or two friendly neighborly sentences.",
 "suggested_price_cents": integer US cents for the natural unit, or null if unsure,
 "suggested_unit": "dozen|lb|jar|bunch|each" or null}`,
      turns: [{
        role: 'user',
        parts: [
          { imageB64: imageBase64, mediaType: media },
          { text: `Draft a "${type}" listing for what this photo shows. Fill every field of the schema.` },
        ],
      }],
      maxTokens: 1024, json: true,
    });
    if (!r.text.trim()) {
      await releaseDailyCap(userId);
      return json({ error: 'No draft produced — try again.' }, 502);
    }
    const parsed = JSON.parse(r.text.replace(/^```json?\s*|\s*```$/g, ''));

    // Validate every field server-side — provider output never becomes
    // authoritative data unchecked (schema kept in DRAFT_SCHEMA above).
    const draft = {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 80) : '',
      category: CATEGORY_IDS.includes(parsed.category) ? parsed.category : 'other',
      description: typeof parsed.description === 'string' ? parsed.description.slice(0, 400) : '',
      suggested_price_cents: Number.isFinite(Number(parsed.suggested_price_cents))
        ? Math.max(0, Math.min(100000, Math.round(Number(parsed.suggested_price_cents)))) : null,
      suggested_unit: typeof parsed.suggested_unit === 'string' ? parsed.suggested_unit.slice(0, 20) : null,
    };
    if (!draft.title) {
      await releaseDailyCap(userId);
      return json({ error: 'No draft produced — try again.' }, 502);
    }

    await cfgClient.from('ai_usage_log').insert({
      feature: 'draft', user_id: userId, provider: r.provider, model: r.model, images: 1,
      input_tokens: r.inTok, output_tokens: r.outTok,
      estimated_cost_cents: estCents(r.model, r.inTok, r.outTok),
      actual_cost_cents: actualCents(r.provider, r.model, r.inTok, r.outTok),
      free_tier: r.provider === 'gemini',
      duration_ms: Date.now() - t0, success: true,
    });

    return json({ draft });
  } catch (e) {
    if (reservedUser) await releaseDailyCap(reservedUser);
    if (e instanceof RateLimitedError) {
      return json({ error: 'Zordy is temporarily busy. Try again shortly.' }, 503);
    }
    console.error('draft-listing error:', e);
    // Surface the upstream cause during beta — invaluable for debugging,
    // and nothing here is more sensitive than an HTTP status + message.
    return json({ error: 'Drafting failed — try again in a moment.', detail: String(e).slice(0, 300) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
