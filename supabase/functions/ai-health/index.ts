// Gnome — AI provider health for Gnome Admin (admins with ai.view only).
//
// GET/POST → which providers are CONFIGURED (booleans from edge env — the DB
// never stores keys and this endpoint never returns key material), the
// current default models, and Gnome HQ's active provider/model from ai_agents.
// POST { ping: true } additionally makes ONE tiny real Gemini call to prove
// liveness (logged to ai_usage_log as feature 'health').
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { MODELS, providerKeys, callWithFallback, textTurn, estCents, actualCents, RateLimitedError } from './providers.ts';

Deno.serve(async (req: Request) => {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json({ error: 'UNAUTHENTICATED' }, 401);

    const { data: member } = await admin.from('admin_users')
      .select('role,status,extra_permissions,denied_permissions').eq('user_id', uid).maybeSingle();
    if (!member || member.status !== 'active') return json({ error: 'NOT_ADMIN' }, 403);
    const { data: preset } = await admin.rpc('admin_role_permissions', { p_role: member.role });
    const perms = new Set([...(preset ?? []), ...(member.extra_permissions ?? [])]);
    const denied = new Set(member.denied_permissions ?? []);
    const has = (p: string) => !denied.has(p) && (perms.has('*') || perms.has(p));
    if (!has('ai.view')) return json({ error: 'NOT_AUTHORIZED' }, 403);

    const keys = providerKeys();
    const { data: hq } = await admin.from('ai_agents')
      .select('provider,model,fallback_provider,fallback_model,status').eq('id', 'gnome_hq').maybeSingle();
    const { data: settings } = await admin.from('ai_settings')
      .select('reads_enabled,writes_paused,allow_paid_fallback').limit(1).maybeSingle();

    let ping: { ok: boolean; ms?: number; model?: string; error?: string } | null = null;
    let wantPing = false;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      wantPing = body?.ping === true;
    }
    if (wantPing) {
      if (settings?.reads_enabled === false) {
        ping = { ok: false, error: 'AI features are paused (reads_enabled=false).' };
      } else if (!keys.gemini) {
        ping = { ok: false, error: 'GEMINI_API_KEY not configured.' };
      } else {
        const t0 = Date.now();
        try {
          const r = await callWithFallback(
            [{ provider: 'gemini', model: MODELS.lite }],
            { system: 'Health check. Reply with exactly: ok', turns: textTurn('ping'), maxTokens: 10 },
          );
          ping = { ok: true, ms: Date.now() - t0, model: r.model };
          await admin.from('ai_usage_log').insert({
            feature: 'health', user_id: uid, provider: r.provider, model: r.model,
            input_tokens: r.inTok, output_tokens: r.outTok,
            estimated_cost_cents: estCents(r.model, r.inTok, r.outTok),
            actual_cost_cents: actualCents(r.provider, r.model, r.inTok, r.outTok),
            free_tier: r.provider === 'gemini',
            duration_ms: Date.now() - t0, success: true,
          });
        } catch (e) {
          ping = {
            ok: false,
            error: e instanceof RateLimitedError
              ? 'Gnome AI is temporarily busy. Try again shortly.'
              : String(e).slice(0, 160),
          };
          await admin.from('ai_usage_log').insert({
            feature: 'health', user_id: uid, provider: 'gemini', model: MODELS.lite,
            duration_ms: Date.now() - t0, success: false, free_tier: true,
          });
        }
      }
    }

    return json({
      providers: {
        gemini: { configured: !!keys.gemini, default_models: MODELS },
        openai: { configured: !!keys.openai },
        anthropic: { configured: !!keys.anthropic },
      },
      hq: hq ? { provider: hq.provider, model: hq.model, status: hq.status } : null,
      settings: {
        reads_enabled: settings?.reads_enabled ?? true,
        writes_paused: settings?.writes_paused ?? true,
        allow_paid_fallback: settings?.allow_paid_fallback ?? false,
      },
      ping,
    });
  } catch (e) {
    console.error('ai-health:', e);
    return json({ error: 'HEALTH_FAILED', detail: String(e).slice(0, 160) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
