// Gnome — conversational onboarding. A gnome asks a new neighbor for the few
// things Gnome needs (first name, last name, email; phone optional) instead of
// showing a cold form.
//
// SECURITY MODEL — the model never writes anything:
//   1. The model returns STRUCTURED JSON: a short reply + whatever fields it
//      believes the user just supplied.
//   2. This function passes those fields to save_onboarding_contact(), a
//      SECURITY DEFINER RPC that re-validates every value (length, email
//      shape, digit count) and derives the PUBLIC display name itself
//      ("First L."). A hallucinated or injected field can only ever become a
//      rejected value, never an arbitrary write.
//   3. Contact details land in user_private_contact, which has no world-read
//      policy — `profiles` is world-readable, so they must never go there.
//
// Degrades safely: if AI is paused/unconfigured this returns
// { ai_available:false } and the app falls back to a plain form that calls the
// same RPC. Onboarding is always skippable — never trap someone in a chat.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  MODELS, type ModelRef, type Turn as PTurn, providerKeys, callWithFallback,
  estCents, actualCents, RateLimitedError,
} from './providers.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TURNS = 14;
const MAX_TURN_CHARS = 500;

const SYSTEM = `You are Gnome, a friendly garden gnome welcoming a new neighbor to Gnome Farmers Market — a neighborhood marketplace for home-grown food.

Your ONLY job right now is a short, warm intake conversation. Collect, in this order, one at a time:
1. first name
2. last name
3. best email for order and request notifications
4. mobile number — OPTIONAL, for delivery and pickup coordination. Say plainly it is optional and never shown to other neighbors.

STYLE: plain text only, no markdown, no emoji spam. One or two short sentences per turn. Ask ONE thing at a time. Never re-ask something already in COLLECTED SO FAR. Acknowledge what they just said before the next question.

PRIVACY, state accurately if asked: only a first name and last initial are ever shown publicly. Full last name, email and phone stay private. Neighbors reach each other through Gnome's in-app messaging, so a phone number is never required.

If they decline a field, accept it gracefully and move on — never pressure, never ask twice.
When everything required (first name, last name, email) is collected, set "done": true and give a one-sentence welcome that mentions they can post their first item from the Post tab.

Reply with ONLY a JSON object, no markdown fence:
{"reply":"what you say next","fields":{"first_name":null,"last_name":null,"email":null,"phone":null},"done":false}
Put a value in "fields" ONLY for something the user supplied in their latest message; otherwise null. Never invent a value. Never put a placeholder like "unknown" or "N/A".`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const t0 = Date.now();
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(401, { error: 'UNAUTHENTICATED' });

    // A user-scoped client so the RPC runs as THEM (auth.uid() inside the
    // SECURITY DEFINER function must be the caller, not the service role).
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );

    const body = await req.json().catch(() => ({}));
    const messages: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];

    // Current state drives the prompt so the gnome never re-asks.
    const { data: state } = await asUser.rpc('my_onboarding_state');
    const collected = {
      first_name: state?.first_name ?? null,
      last_name: state?.last_name ?? null,
      email: state?.contact_email ?? null,
      phone: state?.phone ?? null,
    };

    const { data: settings } = await admin.from('ai_settings')
      .select('reads_enabled, allow_paid_fallback').limit(1).maybeSingle();
    const keys = providerKeys();
    const chain: ModelRef[] = [];
    if (keys.gemini) chain.push({ provider: 'gemini', model: MODELS.lite });
    if (settings?.allow_paid_fallback === true && keys.openai) chain.push({ provider: 'openai', model: 'gpt-4o-mini' });
    if (settings?.allow_paid_fallback === true && keys.anthropic) chain.push({ provider: 'anthropic', model: 'claude-haiku-4-5' });

    // No AI? Tell the app to use the plain form. Onboarding still works.
    if (settings?.reads_enabled === false || !chain.length) {
      return json(200, { ai_available: false, state, reply: null });
    }

    const turns: PTurn[] = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role as 'user' | 'assistant', parts: [{ text: m.content.slice(0, MAX_TURN_CHARS) }] }));

    // Opening turn: no user message yet.
    if (!turns.length) {
      turns.push({ role: 'user', parts: [{ text: '(the neighbor just opened the app for the first time — greet them and ask the first question)' }] });
    }

    let raw = '';
    let provider = ''; let model = ''; let inTok = 0; let outTok = 0;
    try {
      const r = await callWithFallback(chain, {
        system: `${SYSTEM}\n\nCOLLECTED SO FAR (never ask for these again): ${JSON.stringify(collected)}`,
        turns, maxTokens: 300, json: true,
      });
      raw = r.text; provider = r.provider; model = r.model; inTok = r.inTok; outTok = r.outTok;
    } catch (e) {
      if (e instanceof RateLimitedError) return json(200, { ai_available: false, state, reply: null });
      throw e;
    }

    let parsed: { reply?: unknown; fields?: Record<string, unknown>; done?: unknown };
    try {
      parsed = JSON.parse(String(raw).replace(/^```json?\s*|\s*```$/g, ''));
    } catch {
      return json(200, { ai_available: false, state, reply: null });
    }

    // Only pass through fields the user did not already have. The RPC
    // re-validates everything; anything invalid raises and is reported as a
    // gentle retry rather than being stored.
    const f = (parsed.fields ?? {}) as Record<string, unknown>;
    const pick = (k: string, cur: string | null) => {
      const v = f[k];
      if (cur) return null;                       // already stored — never overwrite from chat
      if (typeof v !== 'string') return null;
      const s = v.trim();
      if (!s || /^(unknown|n\/?a|none|null|skip)$/i.test(s)) return null;
      return s.slice(0, 120);
    };
    const next = {
      p_first_name: pick('first_name', collected.first_name),
      p_last_name: pick('last_name', collected.last_name),
      p_email: pick('email', collected.email),
      p_phone: pick('phone', collected.phone),
    };

    let newState = state;
    let saveError: string | null = null;
    const hasAny = Object.values(next).some((v) => v !== null);
    const wantsDone = parsed.done === true;
    if (hasAny || wantsDone) {
      // Mark complete only when the required three are actually present.
      const willHave = {
        first: next.p_first_name ?? collected.first_name,
        last: next.p_last_name ?? collected.last_name,
        email: next.p_email ?? collected.email,
      };
      const complete = wantsDone && !!willHave.first && !!willHave.last && !!willHave.email;
      const { data: saved, error } = await asUser.rpc('save_onboarding_contact', { ...next, p_complete: complete });
      if (error) saveError = error.message;
      else newState = saved;
    }

    await admin.from('ai_usage_log').insert({
      feature: 'onboarding', user_id: uid, provider, model,
      input_tokens: inTok, output_tokens: outTok,
      estimated_cost_cents: estCents(model, inTok, outTok),
      actual_cost_cents: actualCents(provider as 'gemini' | 'openai' | 'anthropic', model, inTok, outTok),
      free_tier: provider === 'gemini', duration_ms: Date.now() - t0, success: true,
    }).then(() => {}, () => {});

    const reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 600) : '';
    return json(200, {
      ai_available: true,
      reply: saveError ? `${reply}\n\n(That one didn't look quite right — mind trying it again?)` : reply,
      state: newState,
      saved: hasAny && !saveError,
    });
  } catch (e) {
    console.error('gnome-onboarding:', e);
    // Never block signup on AI failure — the app falls back to the form.
    return json(200, { ai_available: false, reply: null, state: null });
  }
});
