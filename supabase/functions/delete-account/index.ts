// delete-account — permanent, user-initiated account deletion.
//
// Required by App Store Guideline 5.1.1(v): an app that lets people create an
// account must let them delete it from inside the app. A link to the website
// does not satisfy the rule.
//
// The caller proves identity with their own JWT (verify_jwt is ON); we never
// take a user id from the request body, so one user can never delete another.
// The service-role key stays server-side.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

/** Remove every object the user owns in a bucket namespaced by their uuid. */
async function purgeBucketFolder(admin: any, bucket: string, userId: string) {
  try {
    const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (files?.length) {
      await admin.storage.from(bucket).remove(files.map((f: { name: string }) => `${userId}/${f.name}`));
    }
  } catch {
    // Never block account deletion on storage cleanup.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Not signed in.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Identity comes from the token itself — never from the request body.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'Not signed in.' }, 401);

  try {
    // Wind the account down in dependency order. Listings/claims/messages are
    // kept out of other people's histories by removing this user's rows first;
    // anything still referencing the user cascades with the auth row.
    await admin.from('device_tokens').delete().eq('user_id', user.id);
    await admin.from('claim_messages').delete().eq('sender_id', user.id);
    await admin.from('claims').delete().eq('claimer_id', user.id);

    const { data: myListings } = await admin
      .from('listings')
      .select('id')
      .eq('owner_id', user.id);
    const listingIds = (myListings ?? []).map((l: { id: string }) => l.id);
    if (listingIds.length) {
      // Drop other people's claims on my listings too, so no orphan chat remains.
      await admin.from('claim_messages').delete().in(
        'claim_id',
        (
          (await admin.from('claims').select('id').in('listing_id', listingIds)).data ?? []
        ).map((c: { id: string }) => c.id),
      );
      await admin.from('claims').delete().in('listing_id', listingIds);
      await admin.from('listings').delete().in('id', listingIds);
    }
    // Compliance paperwork: scope links, credential rows, and the uploaded
    // documents themselves. Permits are sensitive and must not outlive the
    // account that submitted them.
    const { data: creds } = await admin
      .from('seller_credentials')
      .select('id')
      .eq('seller_id', user.id);
    const credIds = (creds ?? []).map((c: { id: string }) => c.id);
    if (credIds.length) {
      await admin.from('credential_taxonomy_scope').delete().in('credential_id', credIds);
      await admin.from('seller_credentials').delete().in('id', credIds);
    }
    await purgeBucketFolder(admin, 'compliance-docs', user.id);
    await purgeBucketFolder(admin, 'listing-images', user.id);

    await admin.from('markets').delete().eq('owner_id', user.id);
    await admin.from('user_blocks').delete().eq('blocker_id', user.id);
    await admin.from('user_blocks').delete().eq('blocked_id', user.id);
    await admin.from('events').delete().eq('user_id', user.id);
    await admin.from('profiles').delete().eq('id', user.id);

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ deleted: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not delete the account.' }, 500);
  }
});
