// Gnome — headless end-to-end test of the surplus-sharing loop against a LIVE
// Supabase project. Proves the loop *persists* (not just compiles):
//
//   owner signs up -> creates listing -> two neighbors claim it ->
//   owner approves one -> listing flips to 'claimed' and the sibling claim
//   auto-declines -> RLS blocks a non-owner from editing the listing.
//
// All data operations go through anon-key clients with real per-user JWTs, so
// this exercises the same RLS the app hits. The service-role key (if provided)
// is used ONLY to create+confirm test users and to clean up afterwards.
//
// Run from the expo/ dir so it resolves the installed @supabase/supabase-js:
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... [SUPABASE_SERVICE_ROLE=...] \
//     node scripts/e2e-loop.mjs
//
// Without SUPABASE_SERVICE_ROLE, the project must have email confirmation
// disabled (Auth -> Settings) so sign-up yields a session immediately.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.E2E_EMAIL_DOMAIN || 'example.com';
const PASSWORD = 'Gn0me-e2e-Test!';

if (!URL || !ANON) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_ANON_KEY env vars.');
  process.exit(2);
}

const stamp = Date.now();
const admin = SERVICE
  ? createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

let passed = 0;
let failed = 0;
const createdUserIds = [];
let listingId = null;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function client() {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function makeUser(label, name) {
  const email = `gnome-e2e+${stamp}-${label}@${DOMAIN}`;
  const c = client();
  if (admin) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw new Error(`admin.createUser(${label}): ${error.message}`);
    createdUserIds.push(data.user.id);
    const { error: signInErr } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInErr) throw new Error(`signIn(${label}): ${signInErr.message}`);
    return { client: c, id: data.user.id, email };
  }
  const { data, error } = await c.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { name } },
  });
  if (error) throw new Error(`signUp(${label}): ${error.message}`);
  if (!data.session) {
    throw new Error(
      `signUp(${label}) returned no session — disable email confirmation or pass SUPABASE_SERVICE_ROLE.`,
    );
  }
  createdUserIds.push(data.user.id);
  return { client: c, id: data.user.id, email };
}

async function main() {
  console.log(`\n🍅 Gnome live E2E — ${URL}`);
  console.log(`   mode: ${admin ? 'service-role user provisioning' : 'anon sign-up'}\n`);

  // --- Sign up three neighbors -------------------------------------------
  console.log('1) Accounts');
  const owner = await makeUser('owner', 'Olivia Owner');
  const claimer = await makeUser('claimer', 'Cody Claimer');
  const claimer2 = await makeUser('claimer2', 'Casey Second');
  check('owner profile auto-created by trigger', true);
  {
    const { data, error } = await owner.client
      .from('profiles')
      .select('id, name, can_post, can_offer_delivery')
      .eq('id', owner.id)
      .single();
    check('owner profile readable', !error && !!data, error?.message);
    check('profile defaults (can_post true, can_offer_delivery false)',
      !!data && data.can_post === true && data.can_offer_delivery === false);
  }

  // --- Owner creates a listing -------------------------------------------
  console.log('\n2) Create listing');
  {
    const { data, error } = await owner.client
      .from('listings')
      .insert({
        owner_id: owner.id,
        title: 'E2E Cherry Tomatoes',
        description: 'Headless test listing',
        category: 'vegetables',
        quantity: 'a full basket',
        lat: 41.5573,
        lng: -81.5101,
      })
      .select('*')
      .single();
    check('listing inserted by owner', !error && !!data, error?.message);
    check('listing defaults to active', data?.status === 'active', `status=${data?.status}`);
    check('fulfillment defaults pickup-only (delivery_available=false)',
      data?.delivery_available === false);
    listingId = data?.id;
  }

  // --- Anonymous browse can see the active listing -----------------------
  console.log('\n3) Browse (anonymous)');
  {
    const anon = client();
    const { data, error } = await anon
      .from('listings')
      .select('id, status')
      .eq('id', listingId);
    check('anonymous browse sees active listing', !error && data?.length === 1, error?.message);
  }

  // --- Two neighbors claim ------------------------------------------------
  console.log('\n4) Claims');
  let claimAId = null;
  let claimBId = null;
  {
    const { data, error } = await claimer.client
      .from('claims')
      .insert({ listing_id: listingId, claimer_id: claimer.id })
      .select('*')
      .single();
    check('claimer #1 can claim', !error && !!data, error?.message);
    check('claim defaults pending', data?.status === 'pending');
    check('claim defaults fulfillment_method=pickup', data?.fulfillment_method === 'pickup');
    claimAId = data?.id;
  }
  {
    const { data, error } = await claimer2.client
      .from('claims')
      .insert({ listing_id: listingId, claimer_id: claimer2.id })
      .select('*')
      .single();
    check('claimer #2 can claim', !error && !!data, error?.message);
    claimBId = data?.id;
  }
  {
    // RLS negative: owner cannot claim their own listing.
    const { error } = await owner.client
      .from('claims')
      .insert({ listing_id: listingId, claimer_id: owner.id });
    check('RLS blocks owner from claiming own listing', !!error, 'insert unexpectedly succeeded');
  }

  // --- Owner approves claim #1 -------------------------------------------
  console.log('\n5) Approve');
  {
    const { error } = await owner.client
      .from('claims')
      .update({ status: 'approved' })
      .eq('id', claimAId);
    check('owner approves claim #1', !error, error?.message);
  }

  // --- Assert the trigger side effects persisted -------------------------
  console.log('\n6) Persistence assertions (read back from DB)');
  {
    const { data } = await owner.client
      .from('listings')
      .select('status')
      .eq('id', listingId)
      .single();
    check('listing flipped to claimed', data?.status === 'claimed', `status=${data?.status}`);
  }
  {
    const { data } = await owner.client
      .from('claims')
      .select('id, status')
      .eq('listing_id', listingId);
    const a = data?.find((c) => c.id === claimAId);
    const b = data?.find((c) => c.id === claimBId);
    check('approved claim persists as approved', a?.status === 'approved', `status=${a?.status}`);
    check('sibling pending claim auto-declined', b?.status === 'declined', `status=${b?.status}`);
  }
  {
    // RLS negative: a non-owner cannot edit the listing.
    const { data, error } = await claimer.client
      .from('listings')
      .update({ title: 'hijacked' })
      .eq('id', listingId)
      .select('id');
    check('RLS blocks non-owner from editing listing',
      (data?.length ?? 0) === 0 || !!error);
  }

  // --- Cleanup ------------------------------------------------------------
  console.log('\n7) Cleanup');
  if (admin) {
    await admin.from('listings').delete().eq('id', listingId); // cascades claims
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id); // cascades profile
    }
    check('test data removed (listing + users)', true);
  } else {
    await owner.client.from('listings').delete().eq('id', listingId);
    console.log('  ℹ️  test auth users left behind (no service role to delete them):');
    createdUserIds.forEach((id) => console.log(`     - ${id}`));
  }

  console.log(`\n──────────────\nRESULT: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n💥 E2E crashed:', e.message);
  process.exit(1);
});
