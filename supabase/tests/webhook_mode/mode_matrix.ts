// §13 crossover proof for stripe-webhook: the REAL handler file is served and
// driven over HTTP with controlled env. No real Stripe key, no real Supabase:
// keys are prefix-valid fakes, events are signed with signing secrets we own
// (verification is an HMAC over rawBody + signing secret — the API key plays no
// part), and SUPABASE_URL points at an in-process mock PostgREST that RECORDS
// every write so assertions can see exactly what the handler persisted.
//
// Guard shape under test (branch-scoped): only the plan/bundle subscription
// branch needs a Stripe API client, so only it refuses on a missing
// mode-matched key — 503, dedupe row deleted, billing_events row written.
// Every other event processes from the signed payload alone. The
// signing-secret/livemode consistency gate 400s before anything is written.

const PORT_FN = 8000; // the function file self-serves via Deno.serve (default port)
const PORT_PG = 18272;
const FN_PATH = new URL('../../functions/stripe-webhook/index.ts', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Mock PostgREST: records calls, answers the few endpoints the handler touches.
const calls: { method: string; path: string; body: string }[] = [];
const pgrst = Deno.serve({ port: PORT_PG, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const body = req.method === 'GET' ? '' : await req.text();
  calls.push({ method: req.method, path: url.pathname, body });
  if (url.pathname === '/rest/v1/billing_products') {
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    return new Response('null', { headers: { 'Content-Type': 'application/json' } });
  }
  if (req.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }
  return new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } });
});

// ---------------------------------------------------------------------------
// A genuine Stripe signature: t=<ts>,v1=HMAC_SHA256(secret, `${ts}.${payload}`).
async function sign(payload: string, secret: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${ts},v1=${hex}`;
}

// A checkout.session.completed for the plan/bundle SUBSCRIPTION branch (the one
// with the API call): mode=subscription + client_reference_id, no seed markers.
function subEvent(id: string, livemode: boolean): string {
  return JSON.stringify({
    id, object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000),
    livemode, type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_' + id, object: 'checkout.session', mode: 'subscription',
      client_reference_id: '11111111-2222-3333-4444-555555555555',
      metadata: {}, amount_total: 999, currency: 'usd',
    } },
  });
}

// An event no branch handles: proves the handler PROCESSES (dedupe row written)
// without any Stripe API key at all.
function probeEvent(id: string, livemode: boolean): string {
  return JSON.stringify({
    id, object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000),
    livemode, type: 'gnome.mode_probe', data: { object: { id: 'obj_1' } },
  });
}

const BASE_ENV = {
  SUPABASE_URL: `http://127.0.0.1:${PORT_PG}`,
  SUPABASE_SERVICE_ROLE_KEY: 'service_fake',
  STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_secret_0125',
  STRIPE_WEBHOOK_SECRET_LIVE: 'whsec_live_secret_0125',
};

let fnProc: Deno.ChildProcess | null = null;
async function serveFn(env: Record<string, string>): Promise<void> {
  if (fnProc) { try { fnProc.kill(); await fnProc.status; } catch { /* gone */ } }
  // Network is restricted to localhost: the mock PostgREST is reachable, the
  // real Stripe API is NOT — a branch that gets past the guard and tries an API
  // call fails locally (handler-error path) rather than touching stripe.com.
  const cmd = new Deno.Command('deno', {
    args: ['run', '--allow-net=127.0.0.1,0.0.0.0,localhost', '--allow-env', FN_PATH],
    env: { ...BASE_ENV, ...env }, clearEnv: false, stdout: 'null', stderr: 'null',
  });
  fnProc = cmd.spawn();
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${PORT_FN}/`, { method: 'GET' }); return; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('function server never came up');
}

async function drive(body: string, signWith: string) {
  const sig = await sign(body, signWith);
  const res = await fetch(`http://127.0.0.1:${PORT_FN}/`, {
    method: 'POST', headers: { 'stripe-signature': sig, 'Content-Type': 'application/json' }, body,
  });
  return { status: res.status, text: await res.text() };
}

const wroteDedupe = () => calls.some((k) => k.path === '/rest/v1/stripe_events' && k.method === 'POST');
const deletedDedupe = () => calls.some((k) => k.path === '/rest/v1/stripe_events' && k.method === 'DELETE');
const loggedRefusal = () => calls.some((k) => k.path === '/rest/v1/rpc/billing_log_event' && k.body.includes('no_key_for_mode'));

type Case = {
  name: string;
  env: Record<string, string>;
  body: (id: string) => string;
  signWith: string;
  expect: 'processed' | 'refused_503' | 'mode_contradiction' | 'bad_signature';
};

const W = BASE_ENV;
const CASES: Case[] = [
  // -- the crossover matrix, on the branch that needs the API ---------------
  { name: 'sub LIVE event, only TEST key            -> 503 refusal, dedupe cleaned (no fallback to test)',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_test_abc' },
    body: (id) => subEvent(id, true), signWith: W.STRIPE_WEBHOOK_SECRET_LIVE, expect: 'refused_503' },
  { name: 'sub TEST event, only LIVE key            -> 503 refusal (no fallback to live)',
    env: { STRIPE_SECRET_KEY_LIVE: 'sk_live_abc' },
    body: (id) => subEvent(id, false), signWith: W.STRIPE_WEBHOOK_SECRET_TEST, expect: 'refused_503' },
  { name: 'sub LIVE event, TEST var holds sk_live_  -> 503 (misfiled secret not trusted as live)',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_live_misfiled' },
    body: (id) => subEvent(id, true), signWith: W.STRIPE_WEBHOOK_SECRET_LIVE, expect: 'refused_503' },
  { name: 'sub TEST event, TEST var holds sk_live_  -> 503 (opposite-mode prefix rejected)',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_live_misfiled' },
    body: (id) => subEvent(id, false), signWith: W.STRIPE_WEBHOOK_SECRET_TEST, expect: 'refused_503' },
  { name: 'sub LIVE event, legacy sk_test_ only     -> 503 (legacy cannot cross modes)',
    env: { STRIPE_SECRET_KEY: 'sk_test_legacy' },
    body: (id) => subEvent(id, true), signWith: W.STRIPE_WEBHOOK_SECRET_LIVE, expect: 'refused_503' },
  { name: 'sub LIVE event, legacy sk_live_ only     -> proceeds (legacy honored when prefix proves it)',
    env: { STRIPE_SECRET_KEY: 'sk_live_legacy' },
    body: (id) => subEvent(id, true), signWith: W.STRIPE_WEBHOOK_SECRET_LIVE, expect: 'processed' },
  { name: 'sub TEST event, rk_test_ restricted key  -> proceeds (rk_ prefix recognized)',
    env: { STRIPE_SECRET_KEY_TEST: 'rk_test_abc' },
    body: (id) => subEvent(id, false), signWith: W.STRIPE_WEBHOOK_SECRET_TEST, expect: 'processed' },

  // -- branches that need no API key must keep processing -------------------
  { name: 'probe LIVE event, only TEST key          -> processed (guard is branch-scoped, not a kill switch)',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_test_abc' },
    body: (id) => probeEvent(id, true), signWith: W.STRIPE_WEBHOOK_SECRET_LIVE, expect: 'processed' },
  { name: 'probe TEST event, only LIVE key          -> processed (post-go-live key hygiene keeps test flowing)',
    env: { STRIPE_SECRET_KEY_LIVE: 'sk_live_abc' },
    body: (id) => probeEvent(id, false), signWith: W.STRIPE_WEBHOOK_SECRET_TEST, expect: 'processed' },

  // -- the signing-secret/livemode consistency gate -------------------------
  { name: 'livemode:true signed with TEST secret    -> 400 (forged/misconfigured mode refused)',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_test_abc', STRIPE_SECRET_KEY_LIVE: 'sk_live_abc' },
    body: (id) => probeEvent(id, true), signWith: W.STRIPE_WEBHOOK_SECRET_TEST, expect: 'mode_contradiction' },
  { name: 'SAME secret in both slots, live event    -> processed (duplicate collapses to legacy, gate stands down)',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_test_abc', STRIPE_SECRET_KEY_LIVE: 'sk_live_abc',
           STRIPE_WEBHOOK_SECRET_TEST: 'whsec_same_in_both', STRIPE_WEBHOOK_SECRET_LIVE: 'whsec_same_in_both' },
    body: (id) => probeEvent(id, true), signWith: 'whsec_same_in_both', expect: 'processed' },
  { name: 'livemode:false signed with LIVE secret   -> 400',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_test_abc', STRIPE_SECRET_KEY_LIVE: 'sk_live_abc' },
    body: (id) => probeEvent(id, false), signWith: W.STRIPE_WEBHOOK_SECRET_LIVE, expect: 'mode_contradiction' },
  { name: 'wrong signing secret                     -> 400 before any mode logic',
    env: { STRIPE_SECRET_KEY_TEST: 'sk_test_abc', STRIPE_SECRET_KEY_LIVE: 'sk_live_abc' },
    body: (id) => subEvent(id, true), signWith: 'whsec_wrong', expect: 'bad_signature' },
];

const results: { name: string; pass: boolean; detail: string }[] = [];
let n = 0;
for (const c of CASES) {
  n++;
  await serveFn(c.env);
  calls.length = 0;
  const r = await drive(c.body(`evt_mode_${n}`), c.signWith);
  let pass = false;
  let detail = `status=${r.status} body=${r.text.slice(0, 70)} dedupe_ins=${wroteDedupe()} dedupe_del=${deletedDedupe()}`;
  if (c.expect === 'processed') {
    // Processed far enough to write the dedupe row and never refuse. The fake
    // key means a later REAL API call in the sub branch throws -> handler-error
    // path (500, dedupe row deleted) — that is PAST the guard, which is what
    // this case asserts; the probe events return 200 received.
    pass = wroteDedupe() && !r.text.includes('No Stripe key');
  } else if (c.expect === 'refused_503') {
    pass = r.status === 503 && r.text.includes('No Stripe key') &&
           wroteDedupe() && deletedDedupe() && loggedRefusal();
    detail += ` refusal_logged=${loggedRefusal()}`;
  } else if (c.expect === 'mode_contradiction') {
    pass = r.status === 400 && r.text.includes('contradicts') && !wroteDedupe();
  } else {
    pass = r.status === 400 && r.text.includes('Bad signature') && !wroteDedupe();
  }
  results.push({ name: c.name, pass, detail });
}

// --- resend after an initial mode/key refusal processes once fixed ----------
await serveFn({ STRIPE_SECRET_KEY_TEST: 'sk_test_abc' });          // live key missing
calls.length = 0;
const rid = 'evt_resend_1';
const first = await drive(subEvent(rid, true), W.STRIPE_WEBHOOK_SECRET_LIVE);
results.push({
  name: 'resend #1: refusal deletes its dedupe row (nothing to shadow the retry)',
  pass: first.status === 503 && wroteDedupe() && deletedDedupe(),
  detail: `status=${first.status} ins=${wroteDedupe()} del=${deletedDedupe()}`,
});
await serveFn({ STRIPE_SECRET_KEY_TEST: 'sk_test_abc', STRIPE_SECRET_KEY_LIVE: 'sk_live_abc' });
calls.length = 0;
const second = await drive(subEvent(rid, true), W.STRIPE_WEBHOOK_SECRET_LIVE);
results.push({
  name: 'resend #2: same event id gets PAST the guard once the key exists',
  pass: wroteDedupe() && !second.text.includes('No Stripe key'),
  detail: `status=${second.status} ins=${wroteDedupe()} body=${second.text.slice(0, 60)}`,
});

if (fnProc) { try { fnProc.kill(); await fnProc.status; } catch { /* gone */ } }
await pgrst.shutdown();

let bad = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.pass) { console.log(`      ${r.detail}`); bad++; }
}
console.log(`\nwebhook mode matrix: ${results.length - bad}/${results.length} passed`);
if (bad > 0) Deno.exit(1);
