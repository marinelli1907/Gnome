// Secure Seller Concierge invitation delivery.
//
// The admin app never receives the invitation token and never creates a seller
// password. A random token is generated here, only its SHA-256 hash is stored,
// and Supabase Auth sends the mailbox-verification link. Claim is later bound to
// the verified auth email, account-readiness state, token expiry, and one-time DB
// row by claim_prepared_market().
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const inviteRedirectBase = () => {
  const fallback = 'https://gnomefarmersmarket.com/claim-market';
  const configured = Deno.env.get('GNOME_SELLER_INVITE_REDIRECT') ?? '';
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' && url.pathname.replace(/\/$/, '').endsWith('/claim-market')
      ? configured
      : fallback;
  } catch {
    return fallback;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'UNAUTHENTICATED' });
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth.user) return json(401, { error: 'UNAUTHENTICATED' });

    const body = await req.json().catch(() => ({}));
    if (body.action !== 'send_invite') return json(400, { error: 'UNKNOWN_ACTION' });
    const caseId = String(body.case_id ?? '');
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(caseId) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json(400, { error: 'INVALID_INVITE' });
    }

    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const inviteToken = base64Url(raw);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inviteToken)));
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Use the caller's JWT for the permission-checked, audited preparation RPC.
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { error: prepError } = await caller.rpc('admin_prepare_concierge_invite', {
      p_case: caseId,
      p_email: email,
      p_token_hash: hex(digest),
      p_expires: expires.toISOString(),
    });
    if (prepError) return json(403, { error: 'INVITE_NOT_PREPARED', message: prepError.message });

    // Supabase accepts only configured Auth redirect URLs. A custom app scheme
    // that is missing from that allowlist silently falls back to SITE_URL and
    // drops the Concierge token. Keep the production-safe web route as the
    // fallback; it can finish the claim on any device without an Auth change.
    const redirectBase = inviteRedirectBase()
      .replace(/[?&]token=[^&]*/g, '');
    const join = redirectBase.includes('?') ? '&' : '?';
    const publicAuth = createClient(url, anonKey);
    const { error: sendError } = await publicAuth.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${redirectBase}${join}token=${encodeURIComponent(inviteToken)}`,
      },
    });
    if (sendError) {
      console.error('seller-concierge invite delivery failed:', sendError.message);
      return json(502, { error: 'INVITE_DELIVERY_FAILED', message: 'The invitation was prepared but the email provider did not accept it. Resend from Seller Concierge.' });
    }

    return json(200, { ok: true, case_id: caseId, expires_at: expires.toISOString() });
  } catch (error) {
    console.error('seller-concierge:', error);
    return json(500, { error: 'SELLER_CONCIERGE_FAILED' });
  }
});
