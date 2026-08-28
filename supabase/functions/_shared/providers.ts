// Gnome — provider-neutral AI adapter (single source; copied into each edge
// function's deploy as `providers.ts`).
//
// STRATEGY (pre-revenue): Gemini Developer API free tier is PRIMARY for every
// feature. OpenAI/Anthropic adapters remain fully working but are opt-in:
// they only run when ai_settings.allow_paid_fallback = true, their key is
// present, AND the deployment explicitly says the privacy policy discloses paid
// fallback providers. Business logic never talks to a vendor SDK — it builds a
// chain with resolveChain() and calls callWithFallback(); swapping models later
// is an Admin config change (ai_agents provider/model/fallback_*), not a rewrite.
//
// Free-tier privacy: free-tier Gemini content may be used by Google for
// product improvement → callers must keep MINIMUM-DATA packs (ids, zones,
// counts — never buyer addresses, permit docs, payment or auth data).
//
// Rate limits: free tiers 429. One bounded retry (Retry-After capped at 4s),
// then the next provider in the chain (if any), then RateLimitedError —
// callers surface "Gnome AI is temporarily busy. Try again shortly."

export type Provider = 'gemini' | 'openai' | 'anthropic';
export type Part = { text?: string; imageB64?: string; mediaType?: string };
export type Turn = { role: 'user' | 'assistant'; parts: Part[] };
export type ModelRef = { provider: Provider; model: string };
export type CallResult = {
  text: string; inTok: number; outTok: number;
  provider: Provider; model: string;
};

// Current configured free-tier models. Boardroom keeps a known-working
// Flash-Lite fallback in-process so production agent rows can safely point at
// newer Gemini models without dead-ending a turn.
export const MODELS = {
  hq: 'gemini-3.6-flash',       // HQ / compliance / security / finance / vision
  lite: 'gemini-3.5-flash-lite',// routine specialist agents + site assistant
  vision: 'gemini-3.6-flash',   // Listing Assistant image understanding
} as const;

// Paid-equivalent $/1M tokens (in, out) — for cost telemetry only. Gemini
// calls on the free tier cost $0 actual; we still log the paid-equivalent.
const RATES: Record<string, [number, number]> = {
  'gemini-3.6-flash': [1.5, 7.5],
  'gemini-3.5-flash': [1.5, 9.0],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'claude-haiku-4-5': [1.0, 5.0],
  'claude-sonnet-5': [3.0, 15.0],
  'gpt-4o': [2.5, 10.0],
  'gpt-4o-mini': [0.15, 0.6],
};

export function estCents(model: string, inTok: number, outTok: number): number {
  const [i, o] = RATES[model] ?? [1.0, 5.0];
  return Math.round((inTok * i + outTok * o) / 10_000 * 100) / 100;
}
export function actualCents(provider: Provider, model: string, inTok: number, outTok: number): number {
  return provider === 'gemini' ? 0 : estCents(model, inTok, outTok); // free tier
}

export function providerKeys(): Record<Provider, string | undefined> {
  const paidFallbackDisclosed =
    Deno.env.get('AI_PAID_FALLBACK_DISCLOSED')?.trim().toLowerCase() === 'true';
  return {
    gemini: Deno.env.get('GEMINI_API_KEY')?.trim() || undefined,
    openai: paidFallbackDisclosed ? Deno.env.get('OPENAI_API_KEY')?.trim() || undefined : undefined,
    anthropic: paidFallbackDisclosed ? Deno.env.get('ANTHROPIC_API_KEY')?.trim() || undefined : undefined,
  };
}

export class ProviderError extends Error {
  constructor(public provider: Provider, public status: number, msg: string,
    public rateLimited = false) { super(msg); }
}
export class RateLimitedError extends Error {
  constructor() { super('All providers busy'); }
}

// Ordered call chain. Gemini rides free; paid providers join ONLY when the
// server-side allow_paid_fallback flag is true AND providerKeys exposes them
// through AI_PAID_FALLBACK_DISCLOSED=true.
export function resolveChain(
  preferred: ModelRef | null, fallback: ModelRef | null, allowPaid: boolean,
): ModelRef[] {
  const keys = providerKeys();
  const chain: ModelRef[] = [];
  const push = (r: ModelRef | null) => {
    if (!r || !r.provider || !r.model) return;
    if (!keys[r.provider]) return;
    if (r.provider !== 'gemini' && !allowPaid) return;
    if (!chain.some((c) => c.provider === r.provider && c.model === r.model)) chain.push(r);
  };
  push(preferred);
  push(fallback);
  // Always make sure a stable configured Gemini fallback anchors the chain.
  // Some production agent rows may point at newer/preview Gemini models; a
  // transient 503 or MAX_TOKENS response should fall back to the stable free
  // tier, not end the Boardroom turn.
  push({ provider: 'gemini', model: MODELS.lite });
  return chain;
}

type CallOpts = {
  system: string; turns: Turn[]; maxTokens: number;
  json?: boolean; // ask the model for a pure-JSON body (validated by caller)
};

function geminiThinkingConfig(model: string) {
  const m = model.toLowerCase();
  if (m.includes('gemini-3')) return { thinkingConfig: { thinkingLevel: 'LOW' } };
  if (m.includes('gemini-2.5')) return { thinkingConfig: { thinkingBudget: 0 } };
  return {};
}

async function callGemini(key: string, model: string, o: CallOpts): Promise<CallResult> {
  const contents = o.turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: t.parts.map((p) => p.imageB64
      ? { inline_data: { mime_type: p.mediaType || 'image/jpeg', data: p.imageB64 } }
      : { text: p.text ?? '' }),
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: o.system }] },
        contents,
        generationConfig: {
          maxOutputTokens: o.maxTokens,
          ...geminiThinkingConfig(model),
          ...(o.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
  );
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProviderError('gemini', res.status,
      `gemini ${res.status}: ${JSON.stringify(b).slice(0, 200)}`, res.status === 429);
  }
  const candidate = b.candidates?.[0] ?? {};
  const text = (candidate.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '').join('').trim();
  if (candidate.finishReason === 'MAX_TOKENS' && o.maxTokens < 1800) {
    return callGemini(key, model, { ...o, maxTokens: Math.min(1800, o.maxTokens * 3) });
  }
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new ProviderError('gemini', 0, `gemini ${model} hit max output tokens`);
  }
  const u = b.usageMetadata ?? {};
  return {
    text, provider: 'gemini', model,
    inTok: u.promptTokenCount ?? 0,
    outTok: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

async function callOpenAI(key: string, model: string, o: CallOpts): Promise<CallResult> {
  const messages = [
    { role: 'system', content: o.system },
    ...o.turns.map((t) => ({
      role: t.role,
      content: t.parts.length === 1 && t.parts[0].text !== undefined
        ? t.parts[0].text
        : t.parts.map((p) => p.imageB64
          ? { type: 'image_url', image_url: { url: `data:${p.mediaType || 'image/jpeg'};base64,${p.imageB64}` } }
          : { type: 'text', text: p.text ?? '' }),
    })),
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: o.maxTokens, messages,
      ...(o.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProviderError('openai', res.status,
      `openai ${res.status}: ${JSON.stringify(b).slice(0, 200)}`, res.status === 429);
  }
  return {
    text: b.choices?.[0]?.message?.content ?? '', provider: 'openai', model,
    inTok: b.usage?.prompt_tokens ?? 0, outTok: b.usage?.completion_tokens ?? 0,
  };
}

async function callAnthropic(key: string, model: string, o: CallOpts): Promise<CallResult> {
  const messages = o.turns.map((t) => ({
    role: t.role,
    content: t.parts.map((p) => p.imageB64
      ? { type: 'image', source: { type: 'base64', media_type: p.mediaType || 'image/jpeg', data: p.imageB64 } }
      : { type: 'text', text: p.text ?? '' }),
  }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: o.maxTokens,
      system: o.system + (o.json ? '\nReply with ONLY a JSON object, no markdown.' : ''),
      messages,
    }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProviderError('anthropic', res.status,
      `anthropic ${res.status}: ${JSON.stringify(b).slice(0, 200)}`, res.status === 429);
  }
  return {
    text: b.content?.[0]?.text ?? '', provider: 'anthropic', model,
    inTok: b.usage?.input_tokens ?? 0, outTok: b.usage?.output_tokens ?? 0,
  };
}

async function callOne(ref: ModelRef, o: CallOpts): Promise<CallResult> {
  const key = providerKeys()[ref.provider];
  if (!key) throw new ProviderError(ref.provider, 0, `${ref.provider} not configured`);
  if (ref.provider === 'gemini') return callGemini(key, ref.model, o);
  if (ref.provider === 'openai') return callOpenAI(key, ref.model, o);
  return callAnthropic(key, ref.model, o);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Bounded: per provider at most ONE retry (429 only), then the next provider.
// Never spins; total worst case = chain.length * 2 calls.
export async function callWithFallback(chain: ModelRef[], o: CallOpts): Promise<CallResult> {
  if (!chain.length) throw new ProviderError('gemini', 0, 'no provider configured');
  let sawRateLimit = false;
  let lastErr: unknown = null;
  for (const ref of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callOne(ref, o);
      } catch (e) {
        lastErr = e;
        if (e instanceof ProviderError && e.rateLimited) {
          sawRateLimit = true;
          if (attempt === 0) { await sleep(1500); continue; } // one bounded backoff
          break; // second 429 → next provider
        }
        break; // non-429 → next provider immediately
      }
    }
  }
  if (sawRateLimit) throw new RateLimitedError();
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Single text-in/text-out convenience used by chat-style callers.
export function textTurn(text: string): Turn[] {
  return [{ role: 'user', parts: [{ text }] }];
}
