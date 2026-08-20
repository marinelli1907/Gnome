// Gnome — AI garden planner ("what should I plant right now, here?").
//
// Provider: GEMINI FREE TIER FIRST via ./providers.ts (gemini-3.6-flash —
// Flash-class for plant identification/diagnosis quality; multimodal for the
// "check my plant" photo flow). Paid providers only when allow_paid_fallback
// and AI_PAID_FALLBACK_DISCLOSED are both true.
// verify_jwt stays ON: only signed-in users can call this (also the cost gate).

import {
  MODELS, type ModelRef, type Turn as PTurn, providerKeys, callWithFallback,
  estCents, actualCents, RateLimitedError,
} from './providers.ts';

// --- Cost gate: real signed-in users only, capped per day. -----------------
// verify_jwt has already validated the signature; we only read the claims.
// The anon key's JWT has no `sub`, so bare anon-key calls are rejected — every
// model call is attributable to an account and counted against a daily cap.
import { createClient } from 'npm:@supabase/supabase-js@2';

function userIdFrom(req: Request): string | null {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' && payload.sub.length > 10 ? payload.sub : null;
  } catch {
    return null;
  }
}

// Caps by plan: free users get a real taste; paid Markets get the full
// allowance (a concrete subscription perk alongside listings + boosts).
async function underDailyCap(
  userId: string, feature: string, freeCap: number, paidCap: number,
): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: market } = await admin
    .from('markets').select('plan').eq('owner_id', userId).limit(1).maybeSingle();
  const paid = !!market?.plan && market.plan !== 'free';
  const { data, error } = await admin.rpc('ai_usage_increment', {
    p_user: userId, p_feature: feature, p_cap: paid ? paidCap : freeCap,
  });
  if (error) {
    // Fail open: a broken usage table shouldn't take the feature down.
    console.error('ai_usage_increment error:', error);
    return true;
  }
  return data !== false;
}


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TURNS = 12;          // last N chat turns forwarded
const MAX_TURN_CHARS = 2000;   // per-message cap
const MAX_LOCATION_CHARS = 120;
const COORD_RE = /\b-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/;
const COORD_GLOBAL_RE = /\b-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/g;
const STREET_SUFFIX_RE = /\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|way|place|pl\.?|terrace|ter\.?|trail|trl\.?|parkway|pkwy\.?|highway|hwy\.?)\b/i;
const STREET_ADDRESS_RE = /\b\d{1,6}\s+[A-Za-z0-9'.-]+(?:\s+[A-Za-z0-9'.-]+){0,5}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|boulevard|blvd\.?|way|place|pl\.?|terrace|ter\.?|trail|trl\.?|parkway|pkwy\.?|highway|hwy\.?)\b/gi;
const UNIT_ONLY_RE = /^(?:apt|apartment|unit|suite|ste|#|floor|fl)\b/i;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/g;

const tidyLocation = (s: string) =>
  s.replace(ZIP_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/^,\s*|\s*,\s*$/g, '')
    .trim();

const looksLikeStreetAddress = (s: string) =>
  /\d/.test(s) && STREET_SUFFIX_RE.test(s);

/**
 * Garden Planner needs climate context, not a doorstep. Keep city/state-style
 * values and drop/reject exact-address shapes before the prompt is built.
 */
export function coarsenGardenLocation(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().replace(/\s+/g, ' ').slice(0, MAX_LOCATION_CHARS);
  if (raw.length < 2 || COORD_RE.test(raw)) return null;

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !looksLikeStreetAddress(p) && !UNIT_ONLY_RE.test(p));
  const candidate = tidyLocation((kept.length ? kept : parts).join(', '));
  if (candidate.length < 2 || !/[A-Za-z]/.test(candidate)) return null;
  if (looksLikeStreetAddress(candidate)) return null;
  return candidate.slice(0, MAX_LOCATION_CHARS);
}

export function redactGardenPlannerText(input: string): string {
  return input
    .replace(COORD_GLOBAL_RE, '[location redacted]')
    .replace(STREET_ADDRESS_RE, '[address redacted]');
}

const SYSTEM_BASE = `You are Gnome's garden planner — a warm, practical gardening expert inside Gnome, a hyperlocal farmers-market app where neighbors share, trade, buy, and sell homegrown goods.

Ground every answer in the gardener's location and the current date:
- Infer the USDA hardiness zone and typical first/last frost window from the location; say which zone you assumed in one short parenthetical.
- Recommend only what is actually sensible to start NOW (this week/month) there: direct-sow, transplant, start indoors, or "wait until <month>".
- Be concrete: varieties, spacing, sun needs, days-to-maturity, and one common beginner mistake to avoid.
- Vegetable-garden first, but flowers/herbs/fruit are fair game when asked.

Format: tight markdown. Short intro line, then sections with ### headers and - bullets. No tables. Keep the whole reply under ~350 words unless the user asks for a full-season plan.

Gnome tie-in: when it fits naturally (not every reply), remind them that surplus harvest, extra seedlings, or spare seeds can be listed on Gnome for neighbors — free, trade, or sale.

Never give pesticide-safety, food-safety, or medical advice beyond "follow the label / consult your local extension office".`;

interface Turn { role: 'user' | 'assistant'; content: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  try {
    const userId = userIdFrom(req);
    if (!userId) {
      return json({ error: 'Sign in to use the garden planner.' }, 401);
    }

    const cfgClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: settings } = await cfgClient.from('ai_settings')
      .select('reads_enabled, allow_paid_fallback').limit(1).maybeSingle();
    if (settings?.reads_enabled === false) {
      return json({ error: 'The garden planner is paused right now — back soon.' }, 503);
    }
    const keys = providerKeys();
    const chain: ModelRef[] = [];
    if (keys.gemini) chain.push({ provider: 'gemini', model: MODELS.hq });
    if (settings?.allow_paid_fallback === true && keys.openai) chain.push({ provider: 'openai', model: 'gpt-4o' });
    if (settings?.allow_paid_fallback === true && keys.anthropic) chain.push({ provider: 'anthropic', model: 'claude-sonnet-5' });
    if (!chain.length) {
      return json({ error: 'The garden planner is not configured yet.' }, 503);
    }
    if (!(await underDailyCap(userId, 'planner', 10, 40))) {
      return json({ error: "You've hit today's free planner limit — paid plans (Pro and Farm) get 40 questions a day. Your garden will still be there tomorrow! 🌱" }, 429);
    }

    const { location, messages, imageBase64, mediaType } = await req.json();
    const loc = coarsenGardenLocation(location);
    if (!loc) {
      return json({ error: 'Use city + state for your garden, not a street address or exact coordinates.' }, 400);
    }

    const turns: Turn[] = Array.isArray(messages)
      ? messages
          .filter(
            (m: unknown): m is Turn =>
              !!m && typeof m === 'object' &&
              ((m as Turn).role === 'user' || (m as Turn).role === 'assistant') &&
              typeof (m as Turn).content === 'string' && (m as Turn).content.trim().length > 0,
          )
          .slice(-MAX_TURNS)
          .map((m) => ({ role: m.role, content: redactGardenPlannerText(m.content).slice(0, MAX_TURN_CHARS) }))
      : [];
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      turns.push({ role: 'user', content: 'What should I plant right now? Give me a plan.' });
    }

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York',
    });

    // Optional plant photo (the "check my plant" flow): attach it to the
    // final user turn as a vision part. Size-capped; key stays server-side.
    const hasPhoto = typeof imageBase64 === 'string'
      && imageBase64.length > 100 && imageBase64.length < 11_000_000;
    const media = typeof mediaType === 'string' && /^image\/(jpeg|png|webp)$/.test(mediaType)
      ? mediaType : 'image/jpeg';
    const pTurns: PTurn[] = turns.map((t, i) => {
      if (hasPhoto && i === turns.length - 1 && t.role === 'user') {
        return { role: 'user', parts: [{ imageB64: imageBase64, mediaType: media }, { text: t.content }] };
      }
      return { role: t.role, parts: [{ text: t.content }] };
    });

    const t0 = Date.now();
    const r = await callWithFallback(chain, {
      system: `${SYSTEM_BASE}\n\nGardener's location: ${loc}\nToday's date: ${today}`
        + (hasPhoto
          ? `\n\nA PLANT PHOTO IS ATTACHED. Diagnose what you can actually see: identify the plant if possible, then the most likely issue(s) — disease, pest, nutrient deficiency, or water stress — with your confidence level, and 2-4 concrete next steps. If the photo is unclear or it could be several things, say so honestly. Never recommend a specific pesticide product or dosage; for chemical treatment say to follow the label and check with the county extension office.`
          : ''),
      turns: pTurns,
      maxTokens: 1200,
    });
    if (!r.text.trim()) {
      return json({ error: 'No plan came back — try again.' }, 502);
    }
    await cfgClient.from('ai_usage_log').insert({
      feature: 'planner', user_id: userId, provider: r.provider, model: r.model,
      images: hasPhoto ? 1 : 0,
      input_tokens: r.inTok, output_tokens: r.outTok,
      estimated_cost_cents: estCents(r.model, r.inTok, r.outTok),
      actual_cost_cents: actualCents(r.provider, r.model, r.inTok, r.outTok),
      free_tier: r.provider === 'gemini',
      duration_ms: Date.now() - t0, success: true,
    });

    return json({ reply: r.text });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return json({ error: 'Gnome AI is temporarily busy. Try again shortly.' }, 503);
    }
    console.error('garden-planner error:', e);
    // Surface the upstream cause during beta — same policy as draft-listing.
    return json({ error: 'The planner hit a snag — try again in a moment.', detail: String(e).slice(0, 300) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
