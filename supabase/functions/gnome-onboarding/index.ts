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

// --- Contact data never reaches the model -----------------------------------
// Email and phone are parsed HERE, deterministically, and the RPC re-validates
// them. The model's job is conversation, not extraction, so it is shown neither
// the stored record nor the raw text a neighbor typed them into.
const EMAIL_RE = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[A-Za-z]{2,}/g;
// Loose on purpose: this is a REDACTION pattern, so over-matching is the safe
// direction. Seven or more digits with the usual separators.
const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;

// What actually goes over the wire to the provider. Runs on every turn, both
// directions — a model that echoes an address back must not have it logged
// either.
export function redactForProvider(text: string): string {
  return text.replace(EMAIL_RE, '[email redacted]').replace(PHONE_RE, '[phone redacted]');
}

type ParsedContact = { email?: string; phone?: string };

// Deterministic extraction from the neighbor's latest message. Returns only what
// is unambiguously present; anything else is left for the model to ask again.
export function parseContact(text: string): ParsedContact {
  const out: ParsedContact = {};
  const email = text.match(EMAIL_RE)?.[0];
  if (email && email.length <= 254) out.email = email.toLowerCase();
  // Only treat it as a phone when it is not part of the email we just took.
  const rest = email ? text.replace(email, ' ') : text;
  const phone = rest.match(PHONE_RE)?.[0];
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) out.phone = phone.trim();
  }
  return out;
}
const MAX_TURN_CHARS = 500;

const SYSTEM = `You are Gnome, a friendly garden gnome welcoming a new neighbor to Gnome Farmers Market — a neighborhood marketplace for home-grown food.

Your ONLY job right now is a short, warm intake conversation. Collect, in this order, one at a time:
1. first name
2. last name
3. best email for order and request notifications
4. mobile number — OPTIONAL, for delivery and pickup coordination. Say plainly it is optional and never shown to other neighbors.

STYLE: plain text only, no markdown, no emoji spam. One or two short sentences per turn. Ask ONE thing at a time. Ask only for what is listed in STILL NEEDED — you are given field names, never stored values, so never claim to know or repeat back an email, phone number or full name. Acknowledge what they just said before the next question.

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

    // Current state drives the prompt so the gnome never re-asks — but the model
    // is told only WHICH fields are still missing, never their values. Sending
    // the stored record on every turn (as this did) put a neighbor's real email,
    // phone and legal name in front of the provider from turn two onward, and
    // again on every resume. None of it is needed to ask the next question.
    const { data: state } = await asUser.rpc('my_onboarding_state');
    const have = {
      first_name: Boolean(state?.first_name),
      last_name: Boolean(state?.last_name),
      email: Boolean(state?.contact_email),
      phone: Boolean(state?.phone),
    };
    const stillNeeded = (['first_name', 'last_name', 'email', 'phone'] as const)
      .filter((k) => !have[k]);

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

    // The neighbor's own words are the one thing the model legitimately needs —
    // but an address or phone they typed is still contact data, so it is redacted
    // on the way out. Parsing already happened locally, so nothing is lost.
    const turns: PTurn[] = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_TURNS)
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        parts: [{ text: redactForProvider(m.content.slice(0, MAX_TURN_CHARS)) }],
      }));

    // Whatever the neighbor just typed, read deterministically. The model never
    // sees these values and never has to interpret them.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const localFields = lastUser ? parseContact(String(lastUser.content ?? '')) : {};

    // Opening turn: no user message yet.
    if (!turns.length) {
      turns.push({ role: 'user', parts: [{ text: '(the neighbor just opened the app for the first time — greet them and ask the first question)' }] });
    }

    let raw = '';
    let provider = ''; let model = ''; let inTok = 0; let outTok = 0;
    try {
      const r = await callWithFallback(chain, {
        system: `${SYSTEM}\n\nSTILL NEEDED (field names only — you are never given the values): ${JSON.stringify(stillNeeded)}`,
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
    const pick = (k: string, alreadyStored: boolean) => {
      const v = f[k];
      if (alreadyStored) return null;             // never overwrite from chat
      if (typeof v !== 'string') return null;
      const s = v.trim();
      if (!s || /^(unknown|n\/?a|none|null|skip)$/i.test(s)) return null;
      return s.slice(0, 120);
    };
    // Names come from the model (it is reading conversational context); email and
    // phone come from local parsing and fall back to the model only if the
    // deterministic pass found nothing. Either way the RPC re-validates.
    const next = {
      p_first_name: pick('first_name', have.first_name),
      p_last_name: pick('last_name', have.last_name),
      p_email: have.email ? null : (localFields.email ?? pick('email', false)),
      p_phone: have.phone ? null : (localFields.phone ?? pick('phone', false)),
    };

    let newState = state;
    let saveError: string | null = null;
    const hasAny = Object.values(next).some((v) => v !== null);
    const wantsDone = parsed.done === true;
    if (hasAny || wantsDone) {
      // Mark complete only when the required three are actually present.
      const willHave = {
        first: next.p_first_name ? true : have.first_name,
        last: next.p_last_name ? true : have.last_name,
        email: next.p_email ? true : have.email,
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
    // Redacted: an exception can carry the neighbor's own text, and function logs
    // are not a place for a contact record.
    console.error('gnome-onboarding:', redactForProvider(String(e)).slice(0, 500));
    // Never block signup on AI failure — the app falls back to the form.
    return json(200, { ai_available: false, reply: null, state: null });
  }
});
